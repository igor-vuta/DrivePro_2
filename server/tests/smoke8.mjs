// Milestone-7a smoke test: driver points (distance x time) awarded on finish,
// points exposed on profiles, geo lang parameter accepted.
// Usage: node tests/smoke8.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4108;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data8');

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

const rider = await reg('+15558880001', 'Póli Rider');
const drv = await reg('+15558880002', 'Dan Driver');
await api('PUT', '/api/me/driver', { carMake: 'Lada', carModel: 'Vesta', carColor: 'White', plate: 'KZ 777' }, drv.token);

check('driver starts with 0 points', drv.user.points === 0 || drv.user.points == null);

const d = await connectWs(drv.token);
await d.nextOf('hello');
d.send({ type: 'driver:activate', lat: 43.238, lng: 76.889 });
await d.nextOf('driver:status');

const r = await connectWs(rider.token);
await r.nextOf('hello');

// 12 km ride
r.send({
  type: 'ride:request',
  pickup: { lat: 43.238, lng: 76.889, address: 'Абая 10' },
  dest: { lat: 43.32, lng: 76.95, address: 'Аэропорт Алматы' },
  distanceM: 12000,
  durationS: 900,
});
await r.nextOf('ride:created');
const offer = await d.nextOf('ride:offer');
d.send({ type: 'ride:accept', rideId: offer.ride.id });
await d.nextOf('ride:update');
d.send({ type: 'ride:start', rideId: offer.ride.id });
await d.nextOf('ride:update');
d.send({ type: 'ride:finish', rideId: offer.ride.id });
const fin = await d.nextOf('ride:update');

check('finish message carries pointsEarned', Number.isFinite(fin.pointsEarned) && fin.pointsEarned >= 1);
// ~12 km x ~0 min trip -> minutes clamps to 1 -> ~12 points
check('points follow km x minutes formula', fin.pointsEarned >= 10 && fin.pointsEarned <= 14, `got ${fin.pointsEarned}`);

const meAfter = await api('GET', '/api/me', null, drv.token);
check('points persisted on driver profile', meAfter.json.user.points === fin.pointsEarned, `got ${meAfter.json.user.points}`);

const publicView = await api('GET', `/api/users/${meAfter.json.user.id}`, null, rider.token);
check('points visible on public profile', publicView.json.user.points === fin.pointsEarned);

// rider earned nothing
const riderMe = await api('GET', '/api/me', null, rider.token);
check('rider earns no points', (riderMe.json.user.points || 0) === 0);

// geo lang param does not break the endpoint shape (upstream may be unreachable in CI)
const geo = await api('GET', '/api/geo/search?q=%D0%90%D0%B1%D0%B0%D1%8F&lang=ru', null, rider.token);
check('geo search with lang=ru answers', geo.status === 200 || geo.status === 502, `status ${geo.status}`);

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
