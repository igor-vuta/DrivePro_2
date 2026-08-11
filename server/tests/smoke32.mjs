// L33 smoke test: the security-audit fixes, each pinned as a regression.
//
// Every case here corresponds to a confirmed audit finding and asserts the
// exploit no longer works:
//   - X-Forwarded-For can no longer forge a fresh rate-limit bucket
//   - a banned user is refused the websocket AND kicked off a live one
//   - a password reset closes the victim's live websocket
//   - the map-driver feed carries no resolvable driver id
//   - push subscriptions cannot be stolen or dropped across accounts
//   - a 500 does not echo a raw internal message
//   - the WS re-checks the account per frame (ban mid-session)
// Usage: node tests/smoke32.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4162;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data32');
const ADMIN = 'audit-admin-token';

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
  // TRUSTED_PROXIES set to a non-loopback address, so the test client (on
  // loopback) is NOT trusted and its X-Forwarded-For is ignored - exactly the
  // position a real attacker is in behind Caddy.
  env: { ...process.env, PORT: String(PORT), DATA_DIR, ADMIN_TOKEN: ADMIN, DRIVEPRO_OTP_COOLDOWN_MS: '150', TRUSTED_PROXIES: '10.0.0.1' },
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

async function api(method, p, body, { token, headers } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reg = async (phone, name) => {
  const r = await api('POST', '/api/register', { phone, password: 'almaty2026', name });
  return (await api('POST', '/api/verify', { phone, code: r.json.devCode })).json;
};

const ws = (token) =>
  new Promise((resolve) => {
    const s = new globalThis.WebSocket(`ws://localhost:${PORT}/ws?token=${encodeURIComponent(token)}`);
    const done = (v) => {
      try {
        s.close();
      } catch {}
      resolve(v);
    };
    s.onopen = () => done('open');
    s.onerror = () => done('refused');
    setTimeout(() => done('timeout'), 4000);
  });

// ------------------------------------------------------- ban over websocket ---

const victim = await reg('+77015568001', 'Aigerim');
check('a normal user opens the websocket', (await ws(victim.token)) === 'open');

const ban = await api('POST', `/api/admin/users/${victim.user.id}/ban`, { banned: true }, { headers: { 'x-admin-token': ADMIN } });
check('admin can ban', ban.status === 200 && ban.json.banned === true);

check('a banned user is refused the websocket', (await ws(victim.token)) === 'refused');
check('the banned user is refused HTTP too', [401, 403].includes((await api('GET', '/api/me', null, { token: victim.token })).status));

// Unban and confirm access returns (ban bumped the epoch, so the OLD token is
// dead; a fresh login is required - which is correct).
await api('POST', `/api/admin/users/${victim.user.id}/ban`, { banned: false }, { headers: { 'x-admin-token': ADMIN } });
check('the pre-ban token stays dead after unban (epoch bumped)', (await api('GET', '/api/me', null, { token: victim.token })).status === 401);
const relogin = await api('POST', '/api/login', { phone: '+77015568001', password: 'almaty2026' });
check('a fresh login works after unban', relogin.status === 200 && !!relogin.json.token);

// --------------------------------------------- ban closes a LIVE websocket ---

const live = await reg('+77015568002', 'Dana');
const sock = new globalThis.WebSocket(`ws://localhost:${PORT}/ws?token=${encodeURIComponent(live.token)}`);
let closed = false;
sock.onclose = () => (closed = true);
await new Promise((r) => (sock.onopen = r));
await api('POST', `/api/admin/users/${live.user.id}/ban`, { banned: true }, { headers: { 'x-admin-token': ADMIN } });
await sleep(500);
check('banning a user force-closes their live socket', closed === true);

// ------------------------------------ password reset closes a live socket ---

const rider = await reg('+77015568003', 'Timur');
const rsock = new globalThis.WebSocket(`ws://localhost:${PORT}/ws?token=${encodeURIComponent(rider.token)}`);
let rClosed = false;
rsock.onclose = () => (rClosed = true);
await new Promise((r) => (rsock.onopen = r));
await sleep(250);
const rr = await api('POST', '/api/reset/request', { phone: '+77015568003' });
await api('POST', '/api/reset/confirm', { phone: '+77015568003', code: rr.json.devCode, password: 'newpass2026' });
await sleep(500);
check('a password reset force-closes the old live socket', rClosed === true);

// --------------------------------------- map feed carries no resolvable id ---
//
// Go online as a driver, then watch the map as a rider and confirm the driver
// dots do NOT carry a real user id (which would resolve to name/car/plate).
const driver = await reg('+77015568004', 'Bekzat');
await api('PUT', '/api/me/driver', { carMake: 'Toyota', carModel: 'Camry', carColor: 'White', plate: '777 ABC 02' }, { token: driver.token });
const dsock = new globalThis.WebSocket(`ws://localhost:${PORT}/ws?token=${encodeURIComponent(driver.token)}`);
await new Promise((r) => (dsock.onopen = r));
dsock.send(JSON.stringify({ type: 'driver:activate', lat: 43.24, lng: 76.89 }));
await sleep(300);

const watcher = await reg('+77015568005', 'Gulnara');
const wsock = new globalThis.WebSocket(`ws://localhost:${PORT}/ws?token=${encodeURIComponent(watcher.token)}`);
const drivers = await new Promise((resolve) => {
  wsock.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'map:drivers') resolve(m.drivers);
  };
  wsock.onopen = () => wsock.send(JSON.stringify({ type: 'map:watch', lat: 43.24, lng: 76.89 }));
  setTimeout(() => resolve([]), 4000);
});
check('the driver appears on the watcher map', drivers.length >= 1, JSON.stringify(drivers));
check('the map dot id is not the real driver user id', drivers.every((d) => d.id !== driver.user.id), JSON.stringify(drivers));
check('the map dot id is an opaque short token', drivers.every((d) => typeof d.id === 'string' && d.id.length <= 16));
try {
  dsock.close();
  wsock.close();
} catch {}

// -------------------------------------- push subscriptions are owned ---
//
// One user's subscription cannot be dropped or stolen by another.
const a = await reg('+77015568006', 'Aliya');
const b = await reg('+77015568007', 'Nurlan');
const endpoint = 'https://push.example/owned-by-a';
const sub = { endpoint, keys: { p256dh: 'BPd'.padEnd(87, 'x'), auth: 'abcdefghijklmnop' } };
check('A registers a push subscription', (await api('POST', '/api/push/subscribe', { subscription: sub }, { token: a.token })).status === 200);
const steal = await api('POST', '/api/push/subscribe', { subscription: sub }, { token: b.token });
check('B cannot steal A’s endpoint', steal.status === 409 && steal.json.code === 'sub_conflict', JSON.stringify(steal.json));
// B's unsubscribe naming A's endpoint must not remove A's row.
await api('POST', '/api/push/unsubscribe', { endpoint }, { token: b.token });
const reAdd = await api('POST', '/api/push/subscribe', { subscription: sub }, { token: a.token });
check('B’s unsubscribe did not drop A’s subscription', reAdd.status === 200, JSON.stringify(reAdd.json));

// -------------------------------------- 500s do not leak internal messages ---
//
// A JSON body of `null` reaches a route that assumes an object; the response
// must be a generic message, not the raw exception text.
const res = await fetch(`${BASE}/api/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: 'null',
});
if (res.status === 500) {
  const j = await res.json().catch(() => ({}));
  check('a 500 returns a generic message', j.error === 'internal error', JSON.stringify(j));
} else {
  // If register tolerates null (400), that is also fine - just no 500 leak.
  check('register does not 500 on a null body', res.status !== 500, String(res.status));
}

// ------------------------------------- X-Forwarded-For cannot forge buckets ---
//
// Runs last: it deliberately exhausts the shared register bucket. From one socket, a rotating
// spoofed XFF must NOT reset the bucket - the peer (loopback here) is not a
// trusted proxy, so the header is ignored.
let last = null;
for (let i = 0; i < 40; i++) {
  last = await api(
    'POST',
    '/api/register',
    { phone: `+7702000${String(1000 + i)}`, password: 'almaty2026', name: 'Spoofer' },
    { headers: { 'X-Forwarded-For': `9.9.9.${i}` } }
  );
  if (last.status === 429) break;
}
check('a rotating X-Forwarded-For no longer bypasses the rate limit', last.status === 429, JSON.stringify(last.json));

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
