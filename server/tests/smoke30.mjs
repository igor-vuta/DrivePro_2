// L30 smoke test: security hardening.
//
// Three behaviours are pinned:
//
// 1. A password reset evicts every session issued before it - HTTP and the
//    websocket alike. Resetting a compromised account must throw the thief
//    out, not just change the password under them.
// 2. Tokens issued before the epoch existed (no `sep` claim) stay valid while
//    the account has never been reset - the upgrade must not log everyone
//    out. The test signs such a token itself with the server's own secret.
// 3. Passkeys are capped per account, so a stolen session cannot pile up
//    silent credentials without limit.
//
// The admin-panel escaping added in the same layer is asserted by smoke19,
// which owns the served-HTML checks.
// Usage: node tests/smoke30.mjs

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VirtualAuthenticator, b64url } from './helpers/virtual-authenticator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4159;
const ORIGIN = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data30');

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
  env: { ...process.env, PORT: String(PORT), DATA_DIR, PUBLIC_ORIGIN: ORIGIN, DRIVEPRO_OTP_COOLDOWN_MS: '150' },
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
  const res = await fetch(ORIGIN + p, {
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

const wsResult = (token) =>
  new Promise((resolve) => {
    const ws = new globalThis.WebSocket(`ws://localhost:${PORT}/ws?token=${encodeURIComponent(token)}`);
    const done = (v) => {
      try {
        ws.close();
      } catch {}
      resolve(v);
    };
    ws.onopen = () => done('open');
    ws.onerror = () => done('refused');
    setTimeout(() => done('timeout'), 4000);
  });

const PHONE = '+77015566001';
const reg = await api('POST', '/api/register', { phone: PHONE, password: 'almaty2026', name: 'Aigerim' });
const first = (await api('POST', '/api/verify', { phone: PHONE, code: reg.json.devCode })).json;

// A second session on another "device".
const second = (await api('POST', '/api/login', { phone: PHONE, password: 'almaty2026' })).json;

check('both sessions work over HTTP', (await api('GET', '/api/me', null, first.token)).status === 200 && (await api('GET', '/api/me', null, second.token)).status === 200);
check('a session opens a websocket', (await wsResult(first.token)) === 'open');

// ------------------------------------------------- reset evicts sessions ---

await new Promise((r) => setTimeout(r, 250));
const rr = await api('POST', '/api/reset/request', { phone: PHONE });
const rc = await api('POST', '/api/reset/confirm', { phone: PHONE, code: rr.json.devCode, password: 'newpass2026' });
check('the reset succeeds and returns a fresh session', rc.status === 200 && !!rc.json.token);

check('the first old session is evicted', (await api('GET', '/api/me', null, first.token)).status === 401);
check('the second old session is evicted too', (await api('GET', '/api/me', null, second.token)).status === 401);
check('an evicted session cannot open a websocket', (await wsResult(first.token)) === 'refused');
check('the fresh session works', (await api('GET', '/api/me', null, rc.json.token)).status === 200);
check('the fresh session opens a websocket', (await wsResult(rc.json.token)) === 'open');

// A second reset evicts the session the first reset issued.
await new Promise((r) => setTimeout(r, 250));
const rr2 = await api('POST', '/api/reset/request', { phone: PHONE });
const rc2 = await api('POST', '/api/reset/confirm', { phone: PHONE, code: rr2.json.devCode, password: 'thirdpass26' });
check('each reset evicts the previous generation', (await api('GET', '/api/me', null, rc.json.token)).status === 401 && (await api('GET', '/api/me', null, rc2.json.token)).status === 200);

// ------------------------------------- pre-epoch tokens are not broken ---
//
// Accounts that existed before the epoch column have tokens without `sep`.
// Until their first reset those must keep working - signed here with the
// server's own secret to mimic one.

const OLD_PHONE = '+77015566002';
const reg2 = await api('POST', '/api/register', { phone: OLD_PHONE, password: 'almaty2026', name: 'Dana' });
const dana = (await api('POST', '/api/verify', { phone: OLD_PHONE, code: reg2.json.devCode })).json;
const secret = fs.readFileSync(path.join(DATA_DIR, '.secret'), 'utf8').trim();
const legacy = (() => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const part = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ uid: dana.user.id, iat: now, exp: now + 3600 })}`;
  return `${part}.${crypto.createHmac('sha256', secret).update(part).digest('base64url')}`;
})();
check('a pre-epoch token (no sep claim) still works before any reset', (await api('GET', '/api/me', null, legacy)).status === 200);

await new Promise((r) => setTimeout(r, 250));
const rr3 = await api('POST', '/api/reset/request', { phone: OLD_PHONE });
await api('POST', '/api/reset/confirm', { phone: OLD_PHONE, code: rr3.json.devCode, password: 'freshpass26' });
check('and stops working after the first reset', (await api('GET', '/api/me', null, legacy)).status === 401);

// ----------------------------------------------------------- passkey cap ---

const capUser = (await api('POST', '/api/login', { phone: PHONE, password: 'thirdpass26' })).json;
let lastReg = null;
for (let i = 0; i < 10; i++) {
  const a = new VirtualAuthenticator('localhost', ORIGIN);
  const opts = await api('POST', '/api/passkey/register/options', {}, capUser.token);
  lastReg = await api('POST', '/api/passkey/register', a.register(opts.json.challenge), capUser.token);
}
check('ten passkeys register', lastReg.status === 200, JSON.stringify(lastReg.json));
const eleventh = new VirtualAuthenticator('localhost', ORIGIN);
const opts11 = await api('POST', '/api/passkey/register/options', {}, capUser.token);
const over = await api('POST', '/api/passkey/register', eleventh.register(opts11.json.challenge), capUser.token);
check('the eleventh is refused', over.status === 400 && over.json.code === 'too_many_passkeys', JSON.stringify(over.json));

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
