// L9 smoke test: trust kit - block/report, matching filters, share-my-ride.
// Usage: node tests/smoke13.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4113;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data13');
const ADMIN = 'adm';

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
  env: { ...process.env, PORT: String(PORT), DATA_DIR, ADMIN_TOKEN: ADMIN },
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

async function api(method, p, body, token, extraHeaders) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(extraHeaders || {}),
    },
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

const rider = await reg('+15553330001', 'Rufina');
const drv = await reg('+15553330002', 'Damir');
await api('PUT', '/api/me/driver', { carMake: 'Toyota', carModel: 'Camry', carColor: 'Black', plate: 'KZ 700' }, drv.token);

const D = await connectWs(drv.token);
await D.nextOf('hello');
D.send({ type: 'driver:activate', lat: 43.24, lng: 76.89 });
await D.nextOf('driver:status');
const R = await connectWs(rider.token);
await R.nextOf('hello');

// ---- block filters matching in both directions ----
await api('POST', `/api/users/${drv.user.id}/block`, {}, rider.token);
const blocks = await api('GET', '/api/me/blocks', null, rider.token);
check('block list reflects the block', (blocks.json.blocked || []).includes(drv.user.id));

R.send({ type: 'ride:request', pickup: { lat: 43.24, lng: 76.89, address: 'A' }, dest: { lat: 43.25, lng: 76.9, address: 'B' } });
const created1 = (await R.nextOf('ride:created')).ride;
const offersBlocked = (await D.collect(1500)).filter((m) => m.type === 'ride:offer').map((m) => m.ride.id);
check('blocked driver never sees the request', !offersBlocked.includes(created1.id));

// even a forced accept is refused neutrally
D.send({ type: 'ride:accept', rideId: created1.id });
const errAcc = await D.nextOf('error');
check('forced accept of a blocked pair is refused', errAcc.code === 'taken');

// unblock -> re-request reaches the driver
R.send({ type: 'ride:cancel', rideId: created1.id });
await R.nextOf('ride:cancelled');
await api('POST', `/api/users/${drv.user.id}/unblock`, {}, rider.token);
R.send({ type: 'ride:request', pickup: { lat: 43.24, lng: 76.89, address: 'A' }, dest: { lat: 43.25, lng: 76.9, address: 'B' } });
const created2 = (await R.nextOf('ride:created')).ride;
const offer2 = await D.nextOf('ride:offer');
check('unblock restores matching', offer2.ride.id === created2.id);

// ---- report reaches the admin panel ----
await api('POST', `/api/users/${drv.user.id}/report`, { reason: 'test reason' }, rider.token);
const overview = await api('GET', '/api/admin/overview', null, null, { 'x-admin-token': ADMIN });
check(
  'report shows up for the operator',
  (overview.json.reports || []).some((r) => r.reported === 'Damir' && r.reason === 'test reason')
);

// ---- share-my-ride ----
D.send({ type: 'ride:accept', rideId: created2.id });
await D.nextOf('ride:update');
const share = await api('POST', `/api/rides/${created2.id}/share`, {}, rider.token);
check('participant can create a share link', share.status === 200 && share.json.path.startsWith('/share/'));

const stranger = await reg('+15553330003', 'Sneaky');
const foreign = await api('POST', `/api/rides/${created2.id}/share`, {}, stranger.token);
check('outsiders cannot create a share link', foreign.status === 404);

const pub = await api('GET', `/api/share/${share.json.shareId}`, null, null);
check('public share JSON works without auth', pub.status === 200 && pub.json.status === 'accepted');
check('share exposes driver name and car but no phone', pub.json.driver && pub.json.driver.name === 'Damir' && !('phone' in pub.json.driver));

const page = await fetch(`${BASE}/share/${share.json.shareId}`);
check('share page serves HTML', page.status === 200 && (await page.text()).includes('live ride'));

const missing = await api('GET', '/api/share/nope', null, null);
check('unknown share id is a 404', missing.status === 404);

// finish -> share reflects it
D.send({ type: 'ride:start', rideId: created2.id });
await D.nextOf('ride:update');
D.send({ type: 'ride:finish', rideId: created2.id });
await D.nextOf('ride:update');
const done = await api('GET', `/api/share/${share.json.shareId}`, null, null);
check('share reflects the finished ride', done.json.status === 'finished');

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
