// L8 smoke test: safety hardening - OTP lockout, rate limiting, bans + admin,
// stale-ride sweep.
// Usage: node tests/smoke12.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4112;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data12');
const ADMIN = 'test-admin-token';

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
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR,
    ADMIN_TOKEN: ADMIN,
    DRIVEPRO_STALE_REQUESTED_MS: '800',
    DRIVEPRO_SWEEP_MS: '400',
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
        send(obj) {
          ws.send(JSON.stringify(obj));
        },
      });
    ws.onerror = () => reject(new Error('ws connect failed'));
  });
}

// ---- OTP lockout: 5 wrong guesses burn the code ----
const reg1 = await api('POST', '/api/register', { phone: '+15550001001', password: 'pass1234', name: 'Olga' });
const realCode = reg1.json.devCode;
let locked = null;
for (let i = 0; i < 5; i++) {
  locked = await api('POST', '/api/verify', { phone: '+15550001001', code: '0000' });
}
check('5th wrong OTP locks the code', locked.status === 429 && locked.json.code === 'code_locked');
const afterLock = await api('POST', '/api/verify', { phone: '+15550001001', code: realCode });
check('even the real code is dead after lockout', afterLock.status === 400 && afterLock.json.code === 'code_expired');

// A fresh code works again (cooldown blocks instant resend - that is fine).
const tooSoon = await api('POST', '/api/resend', { phone: '+15550001001' });
check('resend respects its cooldown', tooSoon.status === 429);

// ---- bans + admin panel ----
const reg2 = await api('POST', '/api/register', { phone: '+15550001002', password: 'pass1234', name: 'Boris' });
const boris = (await api('POST', '/api/verify', { phone: '+15550001002', code: reg2.json.devCode })).json;

const noTok = await api('GET', '/api/admin/overview', null, null);
check('admin overview refuses without token', noTok.status === 401);
const overview = await api('GET', '/api/admin/overview', null, null, { 'x-admin-token': ADMIN });
check('admin overview lists users', overview.status === 200 && overview.json.users.some((u) => u.name === 'Boris'));

const borisId = overview.json.users.find((u) => u.name === 'Boris').id;
await api('POST', `/api/admin/users/${borisId}/ban`, { banned: true }, null, { 'x-admin-token': ADMIN });
const bannedMe = await api('GET', '/api/me', null, boris.token);
check('banned user is locked out of the API', bannedMe.status === 403 && bannedMe.json.code === 'banned');
const bannedLogin = await api('POST', '/api/login', { phone: '+15550001002', password: 'pass1234' });
check('banned user cannot log in', bannedLogin.status === 403 && bannedLogin.json.code === 'banned');
await api('POST', `/api/admin/users/${borisId}/ban`, { banned: false }, null, { 'x-admin-token': ADMIN });
const unbanned = await api('GET', '/api/me', null, boris.token);
check('unban restores access', unbanned.status === 200);

// ---- rate limiting: hammer login past its 20/10min budget ----
let hit429 = false;
for (let i = 0; i < 25; i++) {
  const r = await api('POST', '/api/login', { phone: '+19999999999', password: 'wrong-pass' });
  if (r.status === 429 && r.json.code === 'rate_limited') {
    hit429 = true;
    break;
  }
}
check('login hammering trips the rate limiter', hit429);


// ---- stale sweep: an unanswered request auto-cancels (cutoff 800ms here) ----
const R = await connectWs(boris.token);
await R.nextOf('hello');
R.send({
  type: 'ride:request',
  pickup: { lat: 43.24, lng: 76.89, address: 'A' },
  dest: { lat: 43.25, lng: 76.9, address: 'B' },
});
await R.nextOf('ride:created');
const swept = await R.nextOf('ride:cancelled', 5000);
check('stale request is auto-cancelled by the sweep', swept.ride && swept.ride.cancelledBy === 'system');
const meAfter = await api('GET', '/api/me', null, boris.token);
check('swept ride no longer active', !meAfter.json.activeRide);

// admin page served
const page = await fetch(`${BASE}/admin`);
const pageText = await page.text();
check('operator panel page is served', page.status === 200 && pageText.includes('operator panel'));

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
