// L2 smoke test: route mode - corridor matching for drivers with a set path.
// Usage: node tests/smoke9.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4109;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data9');

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
              if (i >= 0) waiters.splice(i, 1); // drop the stale waiter
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

// A straight route heading north-east across town.
const START = { lat: 43.2, lng: 76.85 };
const END = { lat: 43.3, lng: 76.95 };
const routePoints = [];
for (let i = 0; i <= 20; i++) {
  routePoints.push([START.lat + ((END.lat - START.lat) * i) / 20, START.lng + ((END.lng - START.lng) * i) / 20]);
}
// ~0.003 deg latitude ≈ 330 m; ~0.05 deg ≈ 5.5 km off the path.
const NEAR = 0.003;
const FAR = 0.05;

const rider = await reg('+15559990001', 'Rita');
const rider2 = await reg('+15559990005', 'Rita Two');
const rider3 = await reg('+15559990006', 'Rita Three');
const routeDrv = await reg('+15559990002', 'Ruslan Route');
const plainDrv = await reg('+15559990003', 'Pavel Plain');
const lateDrv = await reg('+15559990004', 'Lena Late');
for (const drv of [routeDrv, plainDrv, lateDrv]) {
  await api('PUT', '/api/me/driver', { carMake: 'Kia', carModel: 'Rio', carColor: 'Grey', plate: 'X1' }, drv.token);
}

const A = await connectWs(routeDrv.token);
await A.nextOf('hello');
A.send({
  type: 'driver:activate',
  lat: START.lat,
  lng: START.lng,
  route: { destLat: END.lat, destLng: END.lng, destAddress: 'Endville', radiusM: 50, points: routePoints },
});
const statusA = await A.nextOf('driver:status');
check('driver:status echoes the route', statusA.route && statusA.route.destAddress === 'Endville');
check('corridor radius is clamped to sane bounds', statusA.route && statusA.route.radiusM === 100);

// re-activate with a proper 1 km corridor
A.send({
  type: 'driver:activate',
  lat: START.lat,
  lng: START.lng,
  route: { destLat: END.lat, destLng: END.lng, destAddress: 'Endville', radiusM: 1000, points: routePoints },
});
await A.nextOf('driver:status');

const B = await connectWs(plainDrv.token);
await B.nextOf('hello');
B.send({ type: 'driver:activate', lat: START.lat, lng: START.lng });
await B.nextOf('driver:status');

const R = await connectWs(rider.token);
await R.nextOf('hello');
const R2 = await connectWs(rider2.token);
await R2.nextOf('hello');
const R3 = await connectWs(rider3.token);
await R3.nextOf('hello');

const request = async (conn, pickup, dest) => {
  conn.send({ type: 'ride:request', pickup: { ...pickup, address: 'P' }, dest: { ...dest, address: 'D' }, distanceM: 5000 });
  const created = await conn.nextOf('ride:created');
  return created.ride.id;
};

// Ride 1: fully on-corridor, right direction (start -> end thirds of the path).
const mid1 = { lat: START.lat + (END.lat - START.lat) * 0.25 + NEAR, lng: START.lng + (END.lng - START.lng) * 0.25 };
const mid2 = { lat: START.lat + (END.lat - START.lat) * 0.75 - NEAR, lng: START.lng + (END.lng - START.lng) * 0.75 };
const ride1 = await request(R, mid1, mid2);
// Ride 2: pickup on path, destination ~5.5 km off the corridor.
const ride2 = await request(R2, mid1, { lat: mid2.lat + FAR, lng: mid2.lng + FAR });
// Ride 3: reverse direction (pickup near end, dest near start).
const ride3 = await request(R3, mid2, mid1);
// cancel nothing; all three stay open

const offersA = (await A.collect(2000)).filter((m) => m.type === 'ride:offer').map((m) => m.ride.id);
const offersB = (await B.collect(500)).filter((m) => m.type === 'ride:offer').map((m) => m.ride.id);

check('route driver gets the on-corridor ride', offersA.includes(ride1));
check('route driver skips the off-corridor destination', !offersA.includes(ride2));
check('route driver skips the wrong-direction ride', !offersA.includes(ride3));
check('plain driver still sees all three', offersB.includes(ride1) && offersB.includes(ride2) && offersB.includes(ride3));

// Late driver activates with the same route AFTER the requests exist:
// the replay path must apply the same corridor filter.
const C = await connectWs(lateDrv.token);
await C.nextOf('hello');
C.send({
  type: 'driver:activate',
  lat: START.lat,
  lng: START.lng,
  route: { destLat: END.lat, destLng: END.lng, destAddress: 'Endville', radiusM: 1000, points: routePoints },
});
await C.nextOf('driver:status');
const offersC = (await C.collect(1500)).filter((m) => m.type === 'ride:offer').map((m) => m.ride.id);
check('late route driver replay only offers the matching ride', offersC.includes(ride1) && !offersC.includes(ride2) && !offersC.includes(ride3));

// Plain re-activate without route clears route mode.
A.send({ type: 'driver:activate', lat: START.lat, lng: START.lng });
const statusA2 = await A.nextOf('driver:status');
check('re-activating without a route clears it', !statusA2.route);
const offersA2 = (await A.collect(1500)).filter((m) => m.type === 'ride:offer').map((m) => m.ride.id);
check('routeless replay now offers everything open', offersA2.includes(ride2) && offersA2.includes(ride3));

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
