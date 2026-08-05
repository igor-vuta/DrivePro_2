// L7 smoke test: convoy - mid-ride corridor offers, multi-passenger accept
// (cap 3), remaining-path matching, driverRides in hello and /api/me.
// Usage: node tests/smoke11.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4111;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data11');

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
            const fn = (m) => {
              clearTimeout(t);
              res2(m);
            };
            const t = setTimeout(() => {
              const i = waiters.indexOf(fn);
              if (i >= 0) waiters.splice(i, 1);
              rej2(new Error('ws timeout'));
            }, timeoutMs);
            waiters.push(fn);
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
        async collect(ms = 1500) {
          const out = [];
          const until = Date.now() + ms;
          for (;;) {
            const left = until - Date.now();
            if (left <= 0) return out;
            try {
              out.push(await this.next(left));
            } catch {
              return out;
            }
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

// Route straight north-east; pos(t) helper for points along it.
const START = { lat: 43.2, lng: 76.85 };
const END = { lat: 43.3, lng: 76.95 };
const at = (f) => ({ lat: START.lat + (END.lat - START.lat) * f, lng: START.lng + (END.lng - START.lng) * f });
const routePoints = [];
for (let i = 0; i <= 20; i++) routePoints.push([at(i / 20).lat, at(i / 20).lng]);

const drv = await reg('+15551230001', 'Kanat Convoy');
const plain = await reg('+15551230002', 'Pavel Plain');
const riders = [];
for (let i = 0; i < 5; i++) riders.push(await reg(`+1555123010${i}`, `Rider ${i + 1}`));
await api('PUT', '/api/me/driver', { carMake: 'GAZ', carModel: 'Gazel', carColor: 'White', plate: 'KZ 01' }, drv.token);
await api('PUT', '/api/me/driver', { carMake: 'Kia', carModel: 'Rio', carColor: 'Red', plate: 'KZ 02' }, plain.token);

const D = await connectWs(drv.token);
await D.nextOf('hello');
D.send({
  type: 'driver:activate',
  lat: START.lat,
  lng: START.lng,
  route: { destLat: END.lat, destLng: END.lng, destAddress: 'End', radiusM: 1000, points: routePoints },
});
await D.nextOf('driver:status');

const P = await connectWs(plain.token);
await P.nextOf('hello');
P.send({ type: 'driver:activate', lat: START.lat, lng: START.lng });
await P.nextOf('driver:status');

const conns = [];
for (const r of riders) {
  const c = await connectWs(r.token);
  await c.nextOf('hello');
  conns.push(c);
}
const request = async (i, pf, df) => {
  conns[i].send({
    type: 'ride:request',
    pickup: { ...at(pf), address: `P${i}` },
    dest: { ...at(df), address: `D${i}` },
    distanceM: 3000,
  });
  return (await conns[i].nextOf('ride:created')).ride.id;
};

// Ride 1 along the corridor; driver accepts and STARTS the trip.
const ride1 = await request(0, 0.1, 0.9);
const o1 = await D.nextOf('ride:offer');
D.send({ type: 'ride:accept', rideId: o1.ride.id });
await D.nextOf('ride:update');
D.send({ type: 'ride:start', rideId: ride1 });
await D.nextOf('ride:update');

// Driver is now at 25% of the route.
D.send({ type: 'driver:location', ...at(0.25) });
await new Promise((r) => setTimeout(r, 150));

// Rider 2 ahead on the corridor -> the BUSY driver still gets the offer.
const ride2 = await request(1, 0.5, 0.75);
const o2 = (await D.collect(1800)).filter((m) => m.type === 'ride:offer').map((m) => m.ride.id);
check('driver mid-ride still receives corridor offers', o2.includes(ride2));

// Accept it -> two passengers at once.
D.send({ type: 'ride:accept', rideId: ride2 });
await D.nextOf('ride:update');
const me2 = await api('GET', '/api/me', null, drv.token);
check('convoy holds two active rides', (me2.json.driverRides || []).length === 2);
check('driverRides carry each rider profile', me2.json.driverRides.every((x) => x.rider && x.rider.name));

// Rider 3 BEHIND the driver's current position -> not offered to the route driver.
const ride3 = await request(2, 0.1, 0.4);
const o3 = (await D.collect(1500)).filter((m) => m.type === 'ride:offer').map((m) => m.ride.id);
check('pickups already passed are not offered', !o3.includes(ride3));
const oP = (await P.collect(500)).filter((m) => m.type === 'ride:offer').map((m) => m.ride.id);
check('plain driver still sees the behind-pickup ride', oP.includes(ride3));

// Third passenger fills the convoy (cap = 3).
const ride4 = await request(3, 0.55, 0.85);
await D.nextOf('ride:offer');
D.send({ type: 'ride:accept', rideId: ride4 });
await D.nextOf('ride:update');
const me3 = await api('GET', '/api/me', null, drv.token);
check('convoy reaches the cap of three', (me3.json.driverRides || []).length === 3);

// At the cap: no more offers, and a forced accept is refused.
const ride5 = await request(4, 0.6, 0.9);
const o5 = (await D.collect(1500)).filter((m) => m.type === 'ride:offer').map((m) => m.ride.id);
check('full convoy receives no further offers', !o5.includes(ride5));
D.send({ type: 'ride:accept', rideId: ride5 });
const err = await D.nextOf('error');
check('fourth accept is rejected as convoy_full', err.code === 'convoy_full');

// Driver cannot request a ride of their own while carrying passengers.
D.send({ type: 'ride:request', pickup: { ...at(0.3), address: 'x' }, dest: { ...at(0.6), address: 'y' } });
const err2 = await D.nextOf('error');
check('busy driver cannot request as a rider', /active ride/i.test(err2.message || ''));

// Finish one passenger: two remain, hello still lists them after reconnect.
D.send({ type: 'ride:finish', rideId: ride1 });
await D.nextOf('ride:update');
const D2 = await connectWs(drv.token);
const hello2 = await D2.nextOf('hello');
check('hello lists the remaining convoy', (hello2.driverRides || []).length === 2);

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
