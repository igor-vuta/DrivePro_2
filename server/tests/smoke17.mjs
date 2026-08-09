// L13 smoke test: crews. Create with a generated invite code, join by code
// (normalized), guard rails (double-membership, bad code, full crew), points
// from a finished ride feeding the crew total, crew tag on public profiles,
// weekly standings with rank, owner hand-off and dissolve-on-empty.
// Usage: node tests/smoke17.mjs   (server spawned with DRIVEPRO_CREW_MAX=2)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4120;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data17');

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
  env: { ...process.env, PORT: String(PORT), DATA_DIR, DRIVEPRO_CREW_MAX: '2' },
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

const owner = await reg('+15557770001', 'Timur');
const mate = await reg('+15557770002', 'Aigerim');
const stranger = await reg('+15557770003', 'Bolat');
await api('PUT', '/api/me/driver', { carMake: 'VW', carModel: 'Golf', carColor: 'White', plate: 'KZ 111' }, owner.token);

// ---- create + code shape ----
const created = await api('POST', '/api/crews', { name: 'Neon Wolves' }, owner.token);
check('crew created', created.status === 200 && created.json.crew && created.json.crew.name === 'Neon Wolves');
const code = created.json.crew.code;
check('invite code shape (6 safe chars)', /^[A-HJ-KM-NP-Z2-9]{6}$/.test(code || ''));
check('creator is the owner member', created.json.members.length === 1 && created.json.members[0].isOwner === true);
const dupe = await api('POST', '/api/crews', { name: 'Second' }, owner.token);
check('double-create rejected', dupe.status === 400 && dupe.json.code === 'already_in_crew');
const noName = await api('POST', '/api/crews', { name: 'x' }, stranger.token);
check('short name rejected', noName.status === 400 && noName.json.code === 'crew_name_required');

// ---- join by code (messy input is normalized) ----
const messy = ` ${code.slice(0, 3).toLowerCase()}-${code.slice(3)} `;
const joined = await api('POST', '/api/crews/join', { code: messy }, mate.token);
check('join by messy code works', joined.status === 200 && joined.json.members.length === 2);
const badJoin = await api('POST', '/api/crews/join', { code: 'ZZZZZZ' }, stranger.token);
check('unknown code -> 404', badJoin.status === 404 && badJoin.json.code === 'crew_not_found');
const rejoin = await api('POST', '/api/crews/join', { code }, mate.token);
check('joining twice rejected', rejoin.status === 400 && rejoin.json.code === 'already_in_crew');
const full = await api('POST', '/api/crews/join', { code }, stranger.token);
check('full crew rejected (max 2)', full.status === 400 && full.json.code === 'crew_full');

// ---- a finished ride feeds the crew total ----
const D = await connectWs(owner.token);
await D.nextOf('hello');
D.send({ type: 'driver:activate', lat: 43.24, lng: 76.89 });
await D.nextOf('driver:status');
const R = await connectWs(mate.token);
await R.nextOf('hello');
R.send({ type: 'ride:request', pickup: { lat: 43.24, lng: 76.89, address: 'A' }, dest: { lat: 43.25, lng: 76.9, address: 'B' } });
const ride = (await R.nextOf('ride:created')).ride;
await D.nextOf('ride:offer');
D.send({ type: 'ride:accept', rideId: ride.id });
await D.nextOf('ride:update');
D.send({ type: 'ride:start', rideId: ride.id });
await D.nextOf('ride:update');
D.send({ type: 'ride:finish', rideId: ride.id });
let fin = await D.nextOf('ride:update');
while (!fin.ride || fin.ride.status !== 'finished') fin = await D.nextOf('ride:update');

const mine = await api('GET', '/api/crews/mine', null, owner.token);
check('crew total = driver + rider points', mine.json.crew.points === fin.pointsEarned + 1, JSON.stringify(mine.json.crew));
check('crew week points match', mine.json.week && mine.json.week.points === fin.pointsEarned + 1);
const mateRow = mine.json.members.find((m) => m.name === 'Aigerim');
check('member rows carry week points', mateRow && mateRow.weekPoints === 1);
check('member rows have no contact data', !('phone' in (mateRow || {})) && !('email' in (mateRow || {})));

// ---- crew tag on public profiles + weekly standings ----
const pub = await api('GET', `/api/users/${created.json.members[0].id}`, null, mate.token);
check('public profile shows the crew tag', pub.json.user.crew && pub.json.user.crew.name === 'Neon Wolves');
const weekly = await api('GET', '/api/weekly', null, owner.token);
check(
  'weekly ranks the crew #1',
  weekly.json.me.crew && weekly.json.me.crew.rank === 1 && weekly.json.city.crews[0].name === 'Neon Wolves'
);
check('weekly crew points add both seats', weekly.json.city.crews[0].points === fin.pointsEarned + 1);
const wStranger = await api('GET', '/api/weekly', null, stranger.token);
check('crewless weekly has no crew entry', !wStranger.json.me.crew);

// ---- owner hand-off + dissolve on empty ----
const left = await api('POST', '/api/crews/leave', null, owner.token);
check('owner can leave', left.status === 200);
const mine2 = await api('GET', '/api/crews/mine', null, mate.token);
check('ownership passed to the remaining member', mine2.json.members.length === 1 && mine2.json.members[0].isOwner === true);
await api('POST', '/api/crews/leave', null, mate.token);
const gone = await api('POST', '/api/crews/join', { code }, stranger.token);
check('empty crew dissolves (code dies)', gone.status === 404);
const mine3 = await api('GET', '/api/crews/mine', null, mate.token);
check('mine reports no crew after leaving', mine3.status === 200 && mine3.json.crew === null);
const leaveAgain = await api('POST', '/api/crews/leave', null, mate.token);
check('leaving twice rejected', leaveAgain.status === 400 && leaveAgain.json.code === 'not_in_crew');

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
