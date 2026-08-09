// L12 smoke test: streaks + live city impact.
// Unit level: the multiplier curve and the day-roll logic (extend / keep /
// reset / best) against a throwaway Store. E2E level: a real ride makes the
// flame move, multiplies points, and the city impact counter is seeded in
// 'hello', served over REST and re-broadcast live on finish and on driver
// presence changes.
// Usage: node tests/smoke16.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { streakMultiplier, dayKey, prevDayKey } from '../src/streaks.js';
import { Store } from '../src/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4118;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data16');
const UNIT_DIR = path.join(__dirname, '.tmp-data16-unit');

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

// ---- unit: multiplier curve ----
check('multiplier: days 1-2 are flat', streakMultiplier(1) === 1 && streakMultiplier(2) === 1);
check('multiplier: day 3 -> x1.25', streakMultiplier(3) === 1.25 && streakMultiplier(6) === 1.25);
check('multiplier: day 7 -> x1.5', streakMultiplier(7) === 1.5 && streakMultiplier(13) === 1.5);
check('multiplier: day 14 -> x1.75', streakMultiplier(14) === 1.75 && streakMultiplier(29) === 1.75);
check('multiplier: day 30+ -> x2', streakMultiplier(30) === 2 && streakMultiplier(365) === 2);
check('day keys roll over months', prevDayKey('2026-03-01') === '2026-02-28' && prevDayKey('2026-01-01') === '2025-12-31');

// ---- unit: day-roll logic on a throwaway store ----
fs.rmSync(UNIT_DIR, { recursive: true, force: true });
const unit = new Store(UNIT_DIR);
const u = unit.createUser({ phone: '+70000000001', passwordHash: 'x', name: 'Unit', verified: true });
const DAY = 24 * 3600 * 1000;
const base = new Date(2026, 0, 10, 12, 0, 0).getTime(); // noon, DST-proof

check('first ride starts the flame at 1', unit.touchStreak(u.id, base).days === 1);
check('second ride same day keeps 1', unit.touchStreak(u.id, base + 3600 * 1000).days === 1);
check('next-day ride extends to 2', unit.touchStreak(u.id, base + DAY).days === 2);
check('a missed day resets to 1', unit.touchStreak(u.id, base + 3 * DAY).days === 1);
check('best streak is remembered', unit.getUser(u.id).streakBest === 2);
let d = 0;
for (let i = 0; i < 7; i++) d = unit.touchStreak(u.id, base + (5 + i) * DAY).days;
check('7 consecutive days -> streak 7 (x1.5)', d === 7 && streakMultiplier(d) === 1.5);
check('dayKey stored for the last ride', unit.getUser(u.id).lastRideDay === dayKey(base + 11 * DAY));
fs.rmSync(UNIT_DIR, { recursive: true, force: true });

// ---- e2e: server + two clients ----
fs.rmSync(DATA_DIR, { recursive: true, force: true });
const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start')), 8000);
  server.stdout.on('data', (data) => {
    if (String(data).includes('running')) {
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
    const ws = new globalThis.WebSocket(`ws://localhost:${PORT}/ws?token=${encodeURIComponent(token)}`);
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

const rider = await reg('+15556660001', 'Aliya');
const drv = await reg('+15556660002', 'Marat');
await api('PUT', '/api/me/driver', { carMake: 'Kia', carModel: 'K5', carColor: 'Black', plate: 'KZ 777' }, drv.token);

const D = await connectWs(drv.token);
const dHello = await D.nextOf('hello');
check('hello carries the city impact seed', dHello.cityImpact && dHello.cityImpact.rides === 0 && dHello.cityImpact.driversOnline === 0);

D.send({ type: 'driver:activate', lat: 43.24, lng: 76.89 });
await D.nextOf('driver:status');
const impActivate = await D.nextOf('city:impact');
check('going online broadcasts fresh impact', impActivate.impact && impActivate.impact.driversOnline === 1);

const R = await connectWs(rider.token);
const rHello = await R.nextOf('hello');
check('later hello sees the driver online', rHello.cityImpact && rHello.cityImpact.driversOnline === 1);

// ride 1: request -> accept -> start -> finish
R.send({ type: 'ride:request', pickup: { lat: 43.24, lng: 76.89, address: 'A' }, dest: { lat: 43.25, lng: 76.9, address: 'B' } });
const created = (await R.nextOf('ride:created')).ride;
await D.nextOf('ride:offer');
D.send({ type: 'ride:accept', rideId: created.id });
await D.nextOf('ride:update');
D.send({ type: 'ride:start', rideId: created.id });
await D.nextOf('ride:update');
D.send({ type: 'ride:finish', rideId: created.id });

let fin = await D.nextOf('ride:update');
while (!fin.ride || fin.ride.status !== 'finished') fin = await D.nextOf('ride:update');
check('finish pays points', Number.isFinite(fin.pointsEarned) && fin.pointsEarned >= 1);
check('driver flame lights up (day 1, x1)', fin.streak && fin.streak.days === 1 && fin.streak.mult === 1);

let rFin = await R.nextOf('ride:update');
while (!rFin.ride || rFin.ride.status !== 'finished') rFin = await R.nextOf('ride:update');
check('rider flame lights up too', rFin.streak && rFin.streak.days === 1);

const impFinish = await R.nextOf('city:impact');
check('finish re-broadcasts city impact', impFinish.impact && impFinish.impact.rides === 1);

const meD = await api('GET', '/api/me', null, drv.token);
check('driver profile shows the streak', meD.json.user.streakDays === 1 && meD.json.user.streakBest === 1);
check('driver got the points', meD.json.user.points >= fin.pointsEarned);
const meR = await api('GET', '/api/me', null, rider.token);
check('rider streak + point landed', meR.json.user.streakDays === 1 && meR.json.user.points === 1);

const impact = await api('GET', '/api/city/impact', null, rider.token);
check(
  'impact endpoint agrees',
  impact.status === 200 && impact.json.rides === 1 && impact.json.km >= 0 && impact.json.driversOnline === 1
);

// ride 2, same day: streak must NOT double-count the day
R.send({ type: 'ride:request', pickup: { lat: 43.24, lng: 76.89, address: 'A' }, dest: { lat: 43.26, lng: 76.91, address: 'C' } });
const created2 = (await R.nextOf('ride:created')).ride;
await D.nextOf('ride:offer');
D.send({ type: 'ride:accept', rideId: created2.id });
await D.nextOf('ride:update');
D.send({ type: 'ride:start', rideId: created2.id });
await D.nextOf('ride:update');
D.send({ type: 'ride:finish', rideId: created2.id });
let fin2 = await D.nextOf('ride:update');
while (!fin2.ride || fin2.ride.status !== 'finished') fin2 = await D.nextOf('ride:update');
check('second ride same day keeps streak at 1', fin2.streak && fin2.streak.days === 1);
const impact2 = await api('GET', '/api/city/impact', null, rider.token);
check('impact counts both rides today', impact2.json.rides === 2);

// drain the rider's ride-2 finish + impact broadcast before the offline check
let rFin2 = await R.nextOf('ride:update');
while (!rFin2.ride || rFin2.ride.status !== 'finished') rFin2 = await R.nextOf('ride:update');
await R.nextOf('city:impact');

// weekly recap knows the flame
const weekly = await api('GET', '/api/weekly', null, drv.token);
check('weekly recap carries the streak', weekly.status === 200 && weekly.json.me.streak === 1);

// driver goes offline -> live counter drops
D.send({ type: 'driver:deactivate' });
const impOff = await R.nextOf('city:impact');
check('going offline broadcasts driversOnline 0', impOff.impact && impOff.impact.driversOnline === 0);

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
