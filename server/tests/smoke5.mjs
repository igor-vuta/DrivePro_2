// Milestone-5 smoke test: ratings, profile comments, enriched history.
// Usage: node tests/smoke5.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4105;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data5');

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

function connectWs(token) {
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
        next(timeoutMs = 5000) {
          return new Promise((res2, rej2) => {
            if (queue.length) return res2(queue.shift());
            const t = setTimeout(() => rej2(new Error('ws timeout')), timeoutMs);
            waiters.push((m) => {
              clearTimeout(t);
              res2(m);
            });
          });
        },
        async nextOf(type, timeoutMs = 6000) {
          const until = Date.now() + timeoutMs;
          for (;;) {
            const m = await this.next(Math.max(200, until - Date.now()));
            if (m.type === type) return m;
            if (Date.now() > until) throw new Error(`no ${type} message`);
          }
        },
        send(obj) {
          ws.send(JSON.stringify(obj));
        },
      });
    ws.onerror = () => reject(new Error('ws connect failed'));
  });
}

const reg = async (phone, name) => {
  const r = await api('POST', '/api/register', { phone, password: 'pass1234', name });
  return (await api('POST', '/api/verify', { phone, code: r.json.devCode })).json;
};

const rider = await reg('+15553330001', 'Rita Rider');
const drv = await reg('+15553330002', 'Dave Driver');
const stranger = await reg('+15553330003', 'Sam Stranger');
await api('PUT', '/api/me/driver', { carMake: 'VW', carModel: 'Golf', carColor: 'Black', plate: 'D1' }, drv.token);

// run a full ride to completion
const d = await connectWs(drv.token);
await d.nextOf('hello');
d.send({ type: 'driver:activate', lat: 51.5, lng: -0.1 });
await d.nextOf('driver:status');
const r = await connectWs(rider.token);
await r.nextOf('hello');
r.send({
  type: 'ride:request',
  pickup: { lat: 51.5, lng: -0.1, address: 'A st' },
  dest: { lat: 51.52, lng: -0.12, address: 'B rd' },
});
const ride = (await r.nextOf('ride:created')).ride;
await d.nextOf('ride:offer');
d.send({ type: 'ride:accept', rideId: ride.id });
await d.nextOf('ride:update');
await r.nextOf('ride:update');

// rating before finish rejected
{
  const early = await api('POST', `/api/rides/${ride.id}/rating`, { stars: 5 }, rider.token);
  check('rating before finish rejected', early.status === 400);
}

d.send({ type: 'ride:start', rideId: ride.id });
await d.nextOf('ride:update');
await r.nextOf('ride:update');
d.send({ type: 'ride:finish', rideId: ride.id });
await d.nextOf('ride:update');
await r.nextOf('ride:update');

// validation
{
  const bad = await api('POST', `/api/rides/${ride.id}/rating`, { stars: 6 }, rider.token);
  check('stars out of range rejected', bad.status === 400);
  const notMine = await api('POST', `/api/rides/${ride.id}/rating`, { stars: 5 }, stranger.token);
  check('non-participant cannot rate', notMine.status === 404);
}

// rider rates driver with comment; driver gets a live nudge
{
  const ok = await api('POST', `/api/rides/${ride.id}/rating`, { stars: 5, comment: 'Great driver, smooth ride' }, rider.token);
  check('rider rates driver', ok.status === 201 && ok.json.rating.stars === 5);
  check('ratee notified over ws', (await d.nextOf('rating:received')).type === 'rating:received');

  const dup = await api('POST', `/api/rides/${ride.id}/rating`, { stars: 1 }, rider.token);
  check('duplicate rating rejected', dup.status === 409);
}

// driver rates rider (stars only)
{
  const ok = await api('POST', `/api/rides/${ride.id}/rating`, { stars: 4 }, drv.token);
  check('driver rates rider', ok.status === 201);
  await r.nextOf('rating:received');
}

// profiles reflect ratings + comments
{
  const p = await api('GET', `/api/users/${drv.user.id}`, null, rider.token);
  check(
    'driver profile shows avg and comment',
    p.json.user.rating === 5 && p.json.user.ratingCount === 1 && p.json.user.recentComments.length === 1 && /smooth ride/.test(p.json.user.recentComments[0].comment),
    JSON.stringify(p.json)
  );
  check('driver profile counts the finished ride', p.json.user.ridesCount === 1);
  const pr = await api('GET', `/api/users/${rider.user.id}`, null, drv.token);
  check('rider profile shows avg, stars-only rating leaves no comment', pr.json.user.rating === 4 && pr.json.user.recentComments.length === 0);
}

// history is enriched
{
  const h = await api('GET', '/api/rides', null, rider.token);
  const row = h.json.rides[0];
  check(
    'history row has role, counterpart and my rating',
    row.role === 'rider' && row.counterpartName === 'Dave Driver' && row.myRating.stars === 5,
    JSON.stringify(row).slice(0, 200)
  );
  const hd = await api('GET', '/api/rides', null, drv.token);
  check('driver history mirrors it', hd.json.rides[0].role === 'driver' && hd.json.rides[0].counterpartName === 'Rita Rider');
}

r.ws.close();
d.ws.close();

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
