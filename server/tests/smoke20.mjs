// L18 smoke test: password rules and OTP password reset.
//
// Registration enforces min 8 / letters + digits / not-your-phone-number.
// Login deliberately does NOT re-check, so accounts created under the old
// 6-character rule keep working. Reset proves phone ownership with the same
// code machinery as verification: resend cooldown, 5-guess lockout, and it
// verifies the account as a side effect.
// Usage: node tests/smoke20.mjs   (server spawned with a 150ms OTP cooldown)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4136;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data20');
const COOLDOWN_MS = 150;

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
  env: { ...process.env, PORT: String(PORT), DATA_DIR, DRIVEPRO_OTP_COOLDOWN_MS: String(COOLDOWN_MS) },
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const past = () => sleep(COOLDOWN_MS + 50); // let the resend cooldown lapse
const reg = (phone, password, name = 'Aigerim') => api('POST', '/api/register', { phone, password, name });

// ---------------------------------------------- password rules on register ---

const short = await reg('+77015559001', 'ab1234');
check('shorter than 8 rejected', short.status === 400 && short.json.code === 'password_short', JSON.stringify(short.json));

const lettersOnly = await reg('+77015559002', 'password');
check('letters without digits rejected', lettersOnly.status === 400 && lettersOnly.json.code === 'password_weak');

const digitsOnly = await reg('+77015559003', '12345678');
check('digits without letters rejected', digitsOnly.status === 400 && digitsOnly.json.code === 'password_weak');

const withPhone = await reg('+77015559004', 'kz5559004pass');
check('password containing the phone tail rejected', withPhone.status === 400 && withPhone.json.code === 'password_has_phone', JSON.stringify(withPhone.json));

const cyrillic = await reg('+77015559005', 'пароль99');
check('Cyrillic letters count as letters', cyrillic.status === 201, JSON.stringify(cyrillic.json));

// ------------------------------------------------------ login not affected ---

const PHONE = '+77015550001';
const first = await reg(PHONE, 'pass1234');
check('valid password accepted', first.status === 201 && typeof first.json.devCode === 'string');
const verified = await api('POST', '/api/verify', { phone: PHONE, code: first.json.devCode });
check('account verifies', verified.status === 200 && !!verified.json.token);

const loginOk = await api('POST', '/api/login', { phone: PHONE, password: 'pass1234' });
check('login works', loginOk.status === 200 && !!loginOk.json.token);
const loginBad = await api('POST', '/api/login', { phone: PHONE, password: 'abc' });
check('login reports wrong credentials, never the new rules', loginBad.status === 401 && loginBad.json.code === 'wrong_credentials', JSON.stringify(loginBad.json));

// ------------------------------------------------------------ reset: guard ---

// Reset request is deliberately uniform: an unknown number returns the same
// 200 as a real one, so it can neither be used to enumerate accounts nor to
// pump SMS at arbitrary numbers (L33). No code is echoed for an unknown one.
const noAcct = await api('POST', '/api/reset/request', { phone: '+77019998888' });
check('reset for an unknown phone looks identical (200, no code)', noAcct.status === 200 && !noAcct.json.devCode, JSON.stringify(noAcct.json));

// A rapid repeat within the cooldown also returns the uniform 200, but sends
// no second code (would-be enumeration of the cooldown state is closed too).
const tooSoon = await api('POST', '/api/reset/request', { phone: PHONE });
check('a repeat within the cooldown still returns 200 and sends nothing', tooSoon.status === 200 && !tooSoon.json.devCode, JSON.stringify(tooSoon.json));

// ----------------------------------------------------- reset: the happy path ---

await past();
const req = await api('POST', '/api/reset/request', { phone: PHONE });
check('reset request issues a code', req.status === 200 && /^\d{4}$/.test(req.json.devCode || ''), JSON.stringify(req.json));

const weak = await api('POST', '/api/reset/confirm', { phone: PHONE, code: req.json.devCode, password: 'short1' });
check('reset enforces the password rules', weak.status === 400 && weak.json.code === 'password_short');

const wrongCode = await api('POST', '/api/reset/confirm', { phone: PHONE, code: '9999' === req.json.devCode ? '1111' : '9999', password: 'newpass99' });
check('reset rejects a wrong code', wrongCode.status === 400 && wrongCode.json.code === 'code_wrong');

const done = await api('POST', '/api/reset/confirm', { phone: PHONE, code: req.json.devCode, password: 'newpass99' });
check('reset succeeds and signs in', done.status === 200 && !!done.json.token && done.json.user.name === 'Aigerim', JSON.stringify(done.json));

const oldPw = await api('POST', '/api/login', { phone: PHONE, password: 'pass1234' });
check('the old password stops working', oldPw.status === 401 && oldPw.json.code === 'wrong_credentials');
const newPw = await api('POST', '/api/login', { phone: PHONE, password: 'newpass99' });
check('the new password works', newPw.status === 200 && !!newPw.json.token);

const replay = await api('POST', '/api/reset/confirm', { phone: PHONE, code: req.json.devCode, password: 'thirdpass9' });
check('the used code cannot be replayed', replay.status === 400 && replay.json.code === 'code_expired', JSON.stringify(replay.json));

// ------------------------------------------------- reset: lockout after 5 ---

await past();
const lockReq = await api('POST', '/api/reset/request', { phone: PHONE });
check('a second reset code can be requested', lockReq.status === 200);
const bad = lockReq.json.devCode === '0000' ? '1111' : '0000';
let lockStatus = null;
for (let i = 0; i < 5; i++) {
  lockStatus = await api('POST', '/api/reset/confirm', { phone: PHONE, code: bad, password: 'lockpass99' });
}
check('5 wrong codes burn the reset code', lockStatus.status === 429 && lockStatus.json.code === 'code_locked', JSON.stringify(lockStatus.json));
const afterLock = await api('POST', '/api/reset/confirm', { phone: PHONE, code: lockReq.json.devCode, password: 'lockpass99' });
check('the real code is dead after the lockout', afterLock.status === 400 && afterLock.json.code === 'code_expired');
const stillOld = await api('POST', '/api/login', { phone: PHONE, password: 'newpass99' });
check('a locked-out reset leaves the password untouched', stillOld.status === 200 && !!stillOld.json.token);

// ------------------------------- reset also verifies an unfinished account ---

const UPHONE = '+77015550004';
const unfinished = await reg(UPHONE, 'pass1234', 'Timur');
check('unverified account created', unfinished.status === 201);
await past();
const ureq = await api('POST', '/api/reset/request', { phone: UPHONE });
check('unverified account can reset', ureq.status === 200 && /^\d{4}$/.test(ureq.json.devCode || ''));
const udone = await api('POST', '/api/reset/confirm', { phone: UPHONE, code: ureq.json.devCode, password: 'freshpass9' });
check('completing a reset also verifies the phone', udone.status === 200 && udone.json.user.name === 'Timur', JSON.stringify(udone.json));
const ulogin = await api('POST', '/api/login', { phone: UPHONE, password: 'freshpass9' });
check('that account logs in without a verification challenge', ulogin.status === 200 && !!ulogin.json.token, JSON.stringify(ulogin.json));

// ------------------------------------------------------- banned accounts ----

const bannedReset = await api('POST', '/api/reset/confirm', { phone: '+77019998888', code: '1234', password: 'newpass99' });
check('reset confirm for an unknown phone 404s', bannedReset.status === 404 && bannedReset.json.code === 'no_account');

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
