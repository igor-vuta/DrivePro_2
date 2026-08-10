// L14 smoke test: scheduled & recurring rides. Validation guard rails, the
// sweeper turning a due schedule into a real ride request (offered to online
// drivers), once-per-day spawning, pause/resume, one-off deactivation after
// it fires, delete, ownership checks and the per-user schedule cap.
// Usage: node tests/smoke18.mjs   (server spawned with a 250ms sweep)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4122;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data18');

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
  // Overridable so the sweeper can be made pathologically fast on purpose:
  // DRIVEPRO_SCHED_SWEEP_MS=5 reproduces the tick-beats-the-request timing
  // that a loaded CI runner produces, without needing a loaded CI runner.
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR,
    DRIVEPRO_SCHED_SWEEP_MS: process.env.DRIVEPRO_SCHED_SWEEP_MS || '250',
  },
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

const dayOf = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const hhmm = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const soon = () => hhmm(Date.now() + 2 * 60 * 1000); // inside the 10-min lead window
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const A = { lat: 43.24, lng: 76.89, address: 'Дом' };
const B = { lat: 43.25, lng: 76.9, address: 'Офис' };

const rider = await reg('+15558880001', 'Sanzhar');
const drv = await reg('+15558880002', 'Dana');
await api('PUT', '/api/me/driver', { carMake: 'Toyota', carModel: 'Camry', carColor: 'Silver', plate: 'KZ 999' }, drv.token);

// ---- validation ----
const badTime = await api('POST', '/api/schedules', { pickup: A, dest: B, time: '8:30', days: ALL_DAYS }, rider.token);
check('bad time rejected', badTime.status === 400 && badTime.json.code === 'invalid_time');
const noDays = await api('POST', '/api/schedules', { pickup: A, dest: B, time: '08:30', days: [] }, rider.token);
check('empty days rejected', noDays.status === 400 && noDays.json.code === 'invalid_days');
const pastDate = await api('POST', '/api/schedules', { pickup: A, dest: B, time: '08:30', date: '2020-01-01' }, rider.token);
check('past date rejected', pastDate.status === 400 && pastDate.json.code === 'invalid_date');
const noPoints = await api('POST', '/api/schedules', { pickup: { lat: 1 }, dest: B, time: '08:30', days: ALL_DAYS }, rider.token);
check('missing points rejected', noPoints.status === 400 && noPoints.json.code === 'points_required');

// ---- create + spawn ----
const D = await connectWs(drv.token);
await D.nextOf('hello');
D.send({ type: 'driver:activate', lat: 43.24, lng: 76.89 });
await D.nextOf('driver:status');
const R = await connectWs(rider.token);
await R.nextOf('hello');

const made = await api('POST', '/api/schedules', { pickup: A, dest: B, time: soon(), days: [7, 1, 2, 3, 4, 5, 6] }, rider.token);
check('recurring schedule created', made.status === 200 && made.json.schedule.active === true);
check('days are deduped and sorted', JSON.stringify(made.json.schedule.days) === JSON.stringify(ALL_DAYS));
const listed = await api('GET', '/api/schedules', null, rider.token);
check('schedule listed', listed.json.schedules.length === 1);

const createdMsg = await R.nextOf('ride:created', 8000);
check('sweeper spawned the ride', createdMsg.ride && createdMsg.ride.pickupAddress === 'Дом' && createdMsg.scheduled === true);
const offer = await D.nextOf('ride:offer', 8000);
check('online driver got the offer', offer.ride && offer.ride.id === createdMsg.ride.id);

let dup = false;
try {
  await R.nextOf('ride:created', 1300);
  dup = true;
} catch {}
check('no double spawn while active', dup === false);

// ---- pause / resume ----
// Create the second schedule while the rider is STILL on the first ride: the
// sweeper skips a busy rider without marking the schedule spawned, so this
// cannot fire before the pause lands. Creating it after the cancel below
// raced the sweeper tick instead, which is what made this suite flaky on
// slower CI runners - the spawn beat the pause, and the once-per-day guard
// then blocked the resume too.
const s2 = (await api('POST', '/api/schedules', { pickup: A, dest: B, time: soon(), days: ALL_DAYS }, rider.token)).json.schedule;
const paused = await api('PUT', `/api/schedules/${s2.id}`, { active: false }, rider.token);
check('pause works', paused.status === 200 && paused.json.schedule.active === false);

// Free the rider. Now nothing may spawn: the first schedule already fired
// today, and the second one is paused despite being due.
R.send({ type: 'ride:cancel', rideId: createdMsg.ride.id });
await R.nextOf('ride:cancelled');
let spawnedWhileIdle = false;
try {
  await R.nextOf('ride:created', 1500);
  spawnedWhileIdle = true;
} catch {}
check('spawns at most once per day', spawnedWhileIdle === false);
check('paused schedule never fires', spawnedWhileIdle === false);

await api('PUT', `/api/schedules/${s2.id}`, { active: true }, rider.token);
let resumed = null;
try {
  resumed = await R.nextOf('ride:created', 8000);
} catch {}
check('resumed schedule fires', !!resumed && resumed.ride && resumed.scheduled === true, 'no ride:created after resume');
// Leave the rider idle for the one-off below even if the check above failed,
// rather than throwing on `resumed.ride` and losing the rest of the suite.
if (resumed && resumed.ride) {
  R.send({ type: 'ride:cancel', rideId: resumed.ride.id });
  await R.nextOf('ride:cancelled');
}

// ---- one-off: fires once, then deactivates ----
const s3 = (await api('POST', '/api/schedules', { pickup: A, dest: B, time: soon(), date: dayOf(Date.now()) }, rider.token)).json.schedule;
check('one-off accepted for today', s3.date === dayOf(Date.now()) && s3.days === null);
const onceMsg = await R.nextOf('ride:created', 8000);
check('one-off spawned', onceMsg.scheduled === true);
const after = await api('GET', '/api/schedules', null, rider.token);
const s3After = after.json.schedules.find((x) => x.id === s3.id);
check('one-off deactivates after firing', s3After && s3After.active === false);
R.send({ type: 'ride:cancel', rideId: onceMsg.ride.id });
await R.nextOf('ride:cancelled');

// ---- ownership + delete + cap ----
const foreign = await api('PUT', `/api/schedules/${s3.id}`, { active: true }, drv.token);
check('others cannot touch your schedule', foreign.status === 404 && foreign.json.code === 'schedule_not_found');
const del = await api('DELETE', `/api/schedules/${s3.id}`, null, rider.token);
check('delete works', del.status === 200);
const after2 = await api('GET', '/api/schedules', null, rider.token);
check('deleted schedule is gone', !after2.json.schedules.find((x) => x.id === s3.id));

let capHit = null;
for (let i = after2.json.schedules.length; i < 11; i++) {
  capHit = await api('POST', '/api/schedules', { pickup: A, dest: B, time: '23:59', days: [1] }, rider.token);
}
check('per-user cap enforced at 10', capHit && capHit.status === 400 && capHit.json.code === 'too_many_schedules');

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
