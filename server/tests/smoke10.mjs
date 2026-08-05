// L3 smoke test: neon trails - ride geometries stored at request, exposed
// after finish via /api/trails.
// Usage: node tests/smoke10.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4110;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data10');

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

const rider = await reg('+15557770001', 'Tara');
const rider2 = await reg('+15557770003', 'Tina');
const drv = await reg('+15557770002', 'Timur');
await api('PUT', '/api/me/driver', { carMake: 'BMW', carModel: 'i3', carColor: 'Blue', plate: 'NE ON' }, drv.token);

const D = await connectWs(drv.token);
await D.nextOf('hello');
D.send({ type: 'driver:activate', lat: 43.24, lng: 76.89 });
await D.nextOf('driver:status');

const R = await connectWs(rider.token);
await R.nextOf('hello');
const R2 = await connectWs(rider2.token);
await R2.nextOf('hello');

// Ride with an explicit 10-point route geometry.
const pts = [];
for (let i = 0; i < 10; i++) pts.push([43.24 + i * 0.002, 76.89 + i * 0.002]);
R.send({
  type: 'ride:request',
  pickup: { lat: 43.24, lng: 76.89, address: 'A' },
  dest: { lat: 43.258, lng: 76.908, address: 'B' },
  distanceM: 2500,
  routePoints: pts,
});
await R.nextOf('ride:created');
const offer1 = await D.nextOf('ride:offer');

// Not finished yet -> no trail exposed.
const before = await api('GET', '/api/trails', null, rider.token);
check('unfinished ride leaves no visible trail', (before.json.trails || []).length === 0);

D.send({ type: 'ride:accept', rideId: offer1.ride.id });
await D.nextOf('ride:update');
D.send({ type: 'ride:start', rideId: offer1.ride.id });
await D.nextOf('ride:update');
D.send({ type: 'ride:finish', rideId: offer1.ride.id });
await D.nextOf('ride:update');

const after1 = await api('GET', '/api/trails', null, rider.token);
check('finished ride appears as a trail', (after1.json.trails || []).length === 1);
const t1 = (after1.json.trails || [])[0] || {};
check('trail keeps the full route geometry', Array.isArray(t1.points) && t1.points.length === 10);
check('trail carries its finish time', Number.isFinite(t1.finishedAt) && Date.now() - t1.finishedAt < 60000);

// Second ride WITHOUT routePoints -> straight-line fallback trail.
R2.send({
  type: 'ride:request',
  pickup: { lat: 43.25, lng: 76.9, address: 'C' },
  dest: { lat: 43.26, lng: 76.91, address: 'D' },
  distanceM: 1500,
});
await R2.nextOf('ride:created');
const offer2 = await D.nextOf('ride:offer');
D.send({ type: 'ride:accept', rideId: offer2.ride.id });
await D.nextOf('ride:update');
D.send({ type: 'ride:start', rideId: offer2.ride.id });
await D.nextOf('ride:update');
D.send({ type: 'ride:finish', rideId: offer2.ride.id });
await D.nextOf('ride:update');

const after2 = await api('GET', '/api/trails', null, rider.token);
check('two trails after two finished rides', (after2.json.trails || []).length === 2);
const straight = (after2.json.trails || []).find((t) => t.points.length === 2);
check('routeless ride falls back to a straight-line trail', !!straight);

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
