// L43 smoke test: pickup along the way.
//
// A walker flags that they would accept a lift; a driver on a route that
// covers both where they stand and where they are going sees them - fuzzed
// and anonymised - and may offer. Only after the walker accepts does it
// become a real ride with precise coordinates.
//
// Pinned here:
//   - a walker off the corridor is never shown
//   - a walker on the corridor is shown fuzzed, with an opaque id
//   - the driver's own user id is never in the feed, nor the walker's
//   - a meeting point further than 300 m is refused
//   - accepting creates an accepted ride with the driver assigned
//   - the pickup is the meeting point when one was offered
//   - a walker with an active ride disappears from the feed
// Usage: node tests/smoke35.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4169;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data35');

let passed = 0;
let failed = 0;
const check = (label, cond, extra = '') => {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label} ${extra}`);
  }
};

fs.rmSync(DATA_DIR, { recursive: true, force: true });
const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start')), 8000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('running')) {
      clearTimeout(t);
      resolve();
    }
  });
});
const cleanup = () => {
  try {
    server.kill();
  } catch {}
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
};
process.on('exit', cleanup);

async function api(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws?token=${encodeURIComponent(token)}`);
    const queue = [];
    const waiters = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      const w = waiters.shift();
      if (w) w(msg);
      else queue.push(msg);
    };
    ws.onopen = () =>
      resolve({
        ws,
        send: (o) => ws.send(JSON.stringify(o)),
        next(timeoutMs = 5000) {
          return new Promise((res, rej) => {
            if (queue.length) return res(queue.shift());
            const fn = (m) => {
              clearTimeout(t);
              res(m);
            };
            const t = setTimeout(() => {
              const i = waiters.indexOf(fn);
              if (i >= 0) waiters.splice(i, 1);
              rej(new Error('ws timeout'));
            }, timeoutMs);
            waiters.push(fn);
          });
        },
        async nextOf(type, timeoutMs = 9000) {
          const until = Date.now() + timeoutMs;
          for (;;) {
            const m = await this.next(Math.max(200, until - Date.now()));
            if (m.type === type) return m;
            if (Date.now() > until) throw new Error(`no ${type}`);
          }
        },
      });
    ws.onerror = () => reject(new Error('ws failed'));
  });
}

const reg = async (phone, name) => {
  const r = await api('POST', '/api/register', { phone, password: 'almaty2026', name });
  return (await api('POST', '/api/verify', { phone, code: r.json.devCode })).json;
};

const driver = await reg('+77015569001', 'Bekzat');
const walker = await reg('+77015569002', 'Aisha');
const faraway = await reg('+77015569003', 'Timur');
await api('PUT', '/api/me/driver', { carMake: 'Toyota', carModel: 'Camry', carColor: 'White', plate: '777 ABC 02' }, driver.token);

// A straight west→east corridor along Abay avenue.
const corridor = [];
for (let i = 0; i <= 20; i++) corridor.push([43.24, 76.88 + i * 0.005]);

const D = await connect(driver.token);
await D.nextOf('hello');
D.send({
  type: 'driver:activate',
  lat: 43.24,
  lng: 76.88,
  route: { points: corridor, destLat: 43.24, destLng: 76.98, destAddress: 'East end', radiusM: 800 },
});
await D.nextOf('driver:status');

// ---- a walker far off the corridor is never shown ----
const F = await connect(faraway.token);
await F.nextOf('hello');
F.send({ type: 'walk:available', lat: 43.40, lng: 76.88, destLat: 43.42, destLng: 76.90, destAddress: 'Far north', mode: 'foot' });
await F.nextOf('walk:status');
{
  const feed = await D.nextOf('walk:nearby');
  check('a walker off the corridor is not offered', feed.walkers.length === 0, JSON.stringify(feed.walkers));
}

// ---- a walker on the corridor appears, fuzzed and anonymous ----
const W = await connect(walker.token);
await W.nextOf('hello');
const TRUE_LAT = 43.2402;
const TRUE_LNG = 76.9200;
W.send({ type: 'walk:available', lat: TRUE_LAT, lng: TRUE_LNG, destLat: 43.24, destLng: 76.9700, destAddress: 'East end', mode: 'foot' });
await W.nextOf('walk:status');

let entry = null;
{
  const feed = await D.nextOf('walk:nearby');
  entry = feed.walkers[0];
  check('a walker on the corridor is offered to the driver', feed.walkers.length === 1, JSON.stringify(feed.walkers));
  check('the feed carries no real user id', entry && entry.id !== walker.user.id && entry.id.length <= 16, JSON.stringify(entry));
  check('their name is shown so the driver can decide', entry && entry.person && entry.person.name === 'Aisha');
  check('no phone leaks with it', entry && entry.person && entry.person.phone === undefined);
  const moved = entry ? Math.hypot((entry.lat - TRUE_LAT) * 111000, (entry.lng - TRUE_LNG) * 111000 * Math.cos((TRUE_LAT * Math.PI) / 180)) : 0;
  check('the position is fuzzed, not exact', moved > 20 && moved < 200, `${Math.round(moved)} m`);
}

// ---- the fuzz is stable, so repeated samples cannot average it away ----
{
  const feed = await D.nextOf('walk:nearby');
  const again = feed.walkers[0];
  check('the fuzzed point does not drift between pushes', again && again.lat === entry.lat && again.lng === entry.lng);
}

// ---- a meeting point far from the walker is refused ----
D.send({ type: 'walk:offer', walkerId: entry.id, meetLat: 43.30, meetLng: 76.99 });
{
  const err = await D.nextOf('error');
  check('a distant meeting point is refused', err.code === 'meet_far', JSON.stringify(err));
}

// ---- a nearby meeting point is offered and reaches the walker ----
const MEET_LAT = 43.2410;
const MEET_LNG = 76.9203;
D.send({ type: 'walk:offer', walkerId: entry.id, meetLat: MEET_LAT, meetLng: MEET_LNG });
{
  const offer = await W.nextOf('walk:offer');
  check('the walker receives the offer', !!offer.offerId, JSON.stringify(offer).slice(0, 160));
  check('...with the driver named and their car', offer.driver && offer.driver.name === 'Bekzat' && offer.driver.car && offer.driver.car.plate === '777 ABC 02');
  check('...and the meeting point', offer.meet && Math.abs(offer.meet.lat - MEET_LAT) < 1e-6);
  check('the driver phone is not exposed before agreeing', offer.driver && offer.driver.phone === undefined);

  // ---- accepting creates a real, already-accepted ride ----
  W.send({ type: 'walk:accept', offerId: offer.offerId, pickupAddress: 'By the crossing' });
  const upd = await W.nextOf('ride:update');
  check('accepting creates an accepted ride', upd.ride && upd.ride.status === 'accepted', JSON.stringify(upd.ride).slice(0, 160));
  check('...with the offering driver assigned', upd.ride && upd.ride.driverId === driver.user.id);
  check('...picking up at the agreed meeting point', upd.ride && Math.abs(upd.ride.pickupLat - MEET_LAT) < 1e-6, String(upd.ride && upd.ride.pickupLat));
  check('...heading to where the walker was going', upd.ride && Math.abs(upd.ride.destLng - 76.97) < 1e-6);
  check('now that both agreed, the counterpart is known', !!upd.counterpart && upd.counterpart.name === 'Bekzat');
}

// ---- once riding, they leave the feed ----
// The feed is pushed on a 3s tick as well as on every change, so frames sent
// before the accept are still queued: drain until the settled state arrives.
{
  let feed = null;
  const until = Date.now() + 9000;
  while (Date.now() < until) {
    feed = await D.nextOf('walk:nearby');
    if (feed.walkers.length === 0) break;
  }
  check('a walker who is now riding leaves the feed', feed && feed.walkers.length === 0, JSON.stringify(feed && feed.walkers));
}

// ---- /api/me agrees this is an ordinary ride ----
{
  const me = await api('GET', '/api/me', null, walker.token);
  check('the ride shows up as the walker active ride', me.json.activeRide && me.json.activeRide.status === 'accepted');
}

try {
  D.ws.close();
  W.ws.close();
  F.ws.close();
} catch {}

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
