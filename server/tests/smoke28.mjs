// L27 smoke test: TOTP as an optional second factor.
//
// The maths is checked against the RFC's own published vectors, because a
// TOTP that is subtly wrong still produces plausible six-digit numbers and
// would only be discovered by a user unable to log in.
//
// The behaviour that matters beyond the maths: enabling requires proving the
// app really has the secret, a code cannot be replayed inside its 30-second
// window, and - because the verified phone is the identity and the recovery
// path - a password reset clears the authenticator so a lost phone is not a
// permanent lockout.
// Usage: node tests/smoke28.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hotp, totp, base32Encode, base32Decode, generateSecret, verifyTotp, otpauthUrl } from '../src/totp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4154;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data28');

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

// ------------------------------------------------------------ the maths ---

// RFC 4226 Appendix D, secret "12345678901234567890".
const RFC_SECRET = Buffer.from('12345678901234567890');
const RFC4226 = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
check(
  'HOTP matches the RFC 4226 vectors',
  RFC4226.every((exp, i) => hotp(RFC_SECRET, i) === exp),
  RFC4226.map((_, i) => hotp(RFC_SECRET, i)).join(',')
);

// RFC 6238 Appendix B, SHA1 rows, 8 digits.
const b32 = base32Encode(RFC_SECRET);
const RFC6238 = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];
check(
  'TOTP matches the RFC 6238 vectors',
  RFC6238.every(([sec, exp]) => hotp(base32Decode(b32), Math.floor(sec / 30), 8) === exp)
);
check('base32 survives a round trip', base32Decode(base32Encode(RFC_SECRET)).equals(RFC_SECRET));
check('a generated secret is 160 bits', base32Decode(generateSecret()).length === 20);
check('two secrets differ', generateSecret() !== generateSecret());

// Clock skew either way is tolerated; further out is not.
const S = generateSecret();
const now = Date.now();
check('the current code verifies', verifyTotp(S, totp(S, now), now));
check('one step early verifies', verifyTotp(S, totp(S, now - 30_000), now));
check('one step late verifies', verifyTotp(S, totp(S, now + 30_000), now));
check('two steps out does not', !verifyTotp(S, totp(S, now + 90_000), now));
check('a wrong code does not', !verifyTotp(S, '000000', now) || totp(S, now) === '000000');
check('a short code does not', !verifyTotp(S, '123', now));
check('an empty code does not', !verifyTotp(S, '', now));

const url = otpauthUrl({ secret: S, account: '+77015561001' });
check('the otpauth url names the issuer', url.startsWith('otpauth://totp/DrivePro:') && url.includes('issuer=DrivePro'));
check('it carries the secret and period', url.includes(`secret=${S}`) && url.includes('period=30'));

// ------------------------------------------------------------- the server ---

fs.rmSync(DATA_DIR, { recursive: true, force: true });
const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR, DRIVEPRO_OTP_COOLDOWN_MS: '150' },
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

const PHONE = '+77015561001';
const PASS = 'almaty2026';
const reg = await api('POST', '/api/register', { phone: PHONE, password: PASS, name: 'Aigerim' });
const session = (await api('POST', '/api/verify', { phone: PHONE, code: reg.json.devCode })).json;
const tok = session.token;

const me0 = await api('GET', '/api/me', null, tok);
check('a new account has no second factor', me0.json.totpEnabled === false);

// ------------------------------------------------------------- enrolment ---

const setup = await api('POST', '/api/totp/setup', {}, tok);
check('setup returns a secret and an otpauth url', setup.status === 200 && !!setup.json.secret && setup.json.otpauth.startsWith('otpauth://'));
const secret = setup.json.secret;

const meMid = await api('GET', '/api/me', null, tok);
check('it is not on until a code proves the app has it', meMid.json.totpEnabled === false);

const wrong = await api('POST', '/api/totp/enable', { code: '000000' }, tok);
check('a wrong code does not enable it', wrong.status === 401 && wrong.json.code === 'totp_invalid', JSON.stringify(wrong.json));

const on = await api('POST', '/api/totp/enable', { code: totp(secret) }, tok);
check('the right code enables it', on.status === 200 && on.json.totpEnabled === true, JSON.stringify(on.json));
const me1 = await api('GET', '/api/me', null, tok);
check('/api/me reports it on', me1.json.totpEnabled === true);

// Whether somebody else uses an authenticator is nobody's business.
check('it is not part of the public profile', me1.json.user.totpEnabled === undefined);

// --------------------------------------------------------------- login ---

const noCode = await api('POST', '/api/login', { phone: PHONE, password: PASS });
check('login now asks for the code', noCode.status === 401 && noCode.json.needsTotp === true, JSON.stringify(noCode.json));

const badCode = await api('POST', '/api/login', { phone: PHONE, password: PASS, code: '000000' });
check('a wrong code is refused', badCode.status === 401 && badCode.json.code === 'totp_invalid');

const badPass = await api('POST', '/api/login', { phone: PHONE, password: 'wrongpass9', code: totp(secret) });
check('a right code cannot rescue a wrong password', badPass.status === 401 && badPass.json.code === 'wrong_credentials');

// enable() burned the current step, so a fresh one is needed - waiting for
// the boundary rather than a flat 31s keeps the suite as short as possible.
const nextStep = () => new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 400));
await nextStep();
const good = await api('POST', '/api/login', { phone: PHONE, password: PASS, code: totp(secret) });
check('password plus code logs in', good.status === 200 && !!good.json.token, JSON.stringify(good.json));

// A TOTP stays valid for its whole 30s step, so without burning it a code
// read over someone's shoulder would still work.
const replay = await api('POST', '/api/login', { phone: PHONE, password: PASS, code: totp(secret) });
check('the same code cannot be replayed', replay.status === 401 && replay.json.code === 'totp_reused', JSON.stringify(replay.json));

// ------------------------------------------------------------- recovery ---
//
// The verified phone is the identity and the way back in. Resetting the
// password over it must clear the authenticator, or losing the phone that
// holds it would lock the account permanently.

await new Promise((r) => setTimeout(r, 250));
const rr = await api('POST', '/api/reset/request', { phone: PHONE });
check('a reset code can be requested', rr.status === 200 && !!rr.json.devCode);
const rc = await api('POST', '/api/reset/confirm', { phone: PHONE, code: rr.json.devCode, password: 'newpass2026' });
check('the reset succeeds', rc.status === 200 && !!rc.json.token, JSON.stringify(rc.json));

const afterReset = await api('POST', '/api/login', { phone: PHONE, password: 'newpass2026' });
check('the authenticator is gone after recovery', afterReset.status === 200 && !!afterReset.json.token, JSON.stringify(afterReset.json));
const me2 = await api('GET', '/api/me', null, afterReset.json.token);
check('/api/me confirms it is off', me2.json.totpEnabled === false);

// --------------------------------------------------------- turning it off ---

const setup2 = await api('POST', '/api/totp/setup', {}, afterReset.json.token);
await api('POST', '/api/totp/enable', { code: totp(setup2.json.secret) }, afterReset.json.token);
const dup = await api('POST', '/api/totp/setup', {}, afterReset.json.token);
check('setup is refused while it is already on', dup.status === 409 && dup.json.code === 'totp_already_on');

// Disabling needs a live code, so a borrowed unlocked session cannot remove it.
const offNoCode = await api('POST', '/api/totp/disable', { code: '000000' }, afterReset.json.token);
check('disabling needs a valid code', offNoCode.status === 401 && offNoCode.json.code === 'totp_invalid');

await nextStep(); // the enable above burned this step
const off = await api('POST', '/api/totp/disable', { code: totp(setup2.json.secret) }, afterReset.json.token);
check('a valid code disables it', off.status === 200 && off.json.totpEnabled === false, JSON.stringify(off.json));
const plain = await api('POST', '/api/login', { phone: PHONE, password: 'newpass2026' });
check('login stops asking for a code', plain.status === 200 && !!plain.json.token);

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
