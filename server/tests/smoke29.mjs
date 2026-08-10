// L28 smoke test: passkeys (WebAuthn).
//
// Driven by a virtual authenticator built from node:crypto - it holds a real
// P-256 key, assembles genuine authenticatorData and clientDataJSON, and
// signs them exactly as a phone would. Nothing about the signature path is
// mocked, so this exercises the CBOR decoding, the COSE key conversion and
// the signature verification for real.
//
// The assertions that matter are the ways a passkey login must NOT succeed:
// a challenge that was never issued, a challenge replayed twice, another
// user's credential, a tampered signature, a wrong origin, and a sign count
// that goes backwards (the clone signal).
// Usage: node tests/smoke29.mjs

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4156;
const ORIGIN = `http://localhost:${PORT}`;
const BASE = ORIGIN;
const DATA_DIR = path.join(__dirname, '.tmp-data29');

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

const b64url = (b) => Buffer.from(b).toString('base64url');

// ------------------------------------------------- virtual authenticator ---

function cborBytes(buf) {
  // byte string, major type 2
  if (buf.length < 24) return Buffer.concat([Buffer.from([0x40 | buf.length]), buf]);
  if (buf.length < 256) return Buffer.concat([Buffer.from([0x58, buf.length]), buf]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(buf.length);
  return Buffer.concat([Buffer.from([0x59]), len, buf]);
}
function cborText(str) {
  const b = Buffer.from(str, 'utf8');
  return Buffer.concat([Buffer.from([0x60 | b.length]), b]);
}
function cborMap(pairs) {
  return Buffer.concat([Buffer.from([0xa0 | pairs.length]), ...pairs.flat()]);
}

class VirtualAuthenticator {
  constructor(rpId) {
    this.rpId = rpId;
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    this.credentialId = crypto.randomBytes(32);
    this.signCount = 0;
  }

  authData({ attested }) {
    const rpIdHash = crypto.createHash('sha256').update(this.rpId).digest();
    // UP | UV, plus AT when a credential is attached.
    const flags = Buffer.from([attested ? 0x45 : 0x05]);
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.signCount);
    if (!attested) return Buffer.concat([rpIdHash, flags, count]);

    const jwk = this.publicKey.export({ format: 'jwk' });
    // COSE_Key: {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}
    const cose = cborMap([
      [Buffer.from([0x01]), Buffer.from([0x02])],
      [Buffer.from([0x03]), Buffer.from([0x26])], // -7
      [Buffer.from([0x20]), Buffer.from([0x01])], // -1 : 1
      [Buffer.from([0x21]), cborBytes(Buffer.from(jwk.x, 'base64url'))], // -2
      [Buffer.from([0x22]), cborBytes(Buffer.from(jwk.y, 'base64url'))], // -3
    ]);
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    return Buffer.concat([rpIdHash, flags, count, Buffer.alloc(16), idLen, this.credentialId, cose]);
  }

  clientData(type, challenge, origin = ORIGIN) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
  }

  register(challenge, origin) {
    const authData = this.authData({ attested: true });
    const attestationObject = cborMap([
      [cborText('fmt'), cborText('none')],
      [cborText('attStmt'), Buffer.from([0xa0])],
      [cborText('authData'), cborBytes(authData)],
    ]);
    return {
      challenge,
      attestationObject: b64url(attestationObject),
      clientDataJSON: b64url(this.clientData('webauthn.create', challenge, origin)),
    };
  }

  assert(challenge, { origin, bumpCount = true, tamper = false } = {}) {
    if (bumpCount) this.signCount += 1;
    const authData = this.authData({ attested: false });
    const clientDataJSON = this.clientData('webauthn.get', challenge, origin);
    const signed = Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]);
    const signature = crypto.sign('sha256', signed, { key: this.privateKey, dsaEncoding: 'der' });
    if (tamper) signature[signature.length - 1] ^= 0xff;
    return {
      challenge,
      credentialId: b64url(this.credentialId),
      authenticatorData: b64url(authData),
      clientDataJSON: b64url(clientDataJSON),
      signature: b64url(signature),
    };
  }
}

// --------------------------------------------------------------- server ---

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

const mk = async (phone, name) => {
  const r = await api('POST', '/api/register', { phone, password: 'almaty2026', name });
  return (await api('POST', '/api/verify', { phone, code: r.json.devCode })).json;
};

const health = (await api('GET', '/api/health')).json;
check('the server reports its rpId', health.rpId === 'localhost', health.rpId);

const PHONE = '+77015563001';
const me = await mk(PHONE, 'Aigerim');
const auth = new VirtualAuthenticator('localhost');

// ---------------------------------------------------------- registration ---

const opts = await api('POST', '/api/passkey/register/options', {}, me.token);
check('registration options carry a challenge and the rp', opts.status === 200 && !!opts.json.challenge && opts.json.rp.id === 'localhost', JSON.stringify(opts.json));
check('both ES256 and RS256 are offered', opts.json.pubKeyCredParams.map((p) => p.alg).join(',') === '-7,-257');

const reg = await api('POST', '/api/passkey/register', { ...auth.register(opts.json.challenge), label: 'iPhone' }, me.token);
check('a real attestation registers', reg.status === 200 && !!reg.json.credentialId, JSON.stringify(reg.json));

const list = await api('GET', '/api/passkeys', null, me.token);
check('it is listed with its label', list.json.passkeys.length === 1 && list.json.passkeys[0].label === 'iPhone');
check('the public key is never handed back', JSON.stringify(list.json).includes('PUBLIC KEY') === false);

const meNow = await api('GET', '/api/me', null, me.token);
check('/api/me counts it', meNow.json.passkeys === 1);

// A challenge is single use, so the same registration cannot be replayed.
const replayReg = await api('POST', '/api/passkey/register', auth.register(opts.json.challenge), me.token);
check('a used challenge is refused', replayReg.status === 400 && replayReg.json.code === 'challenge_expired');

// --------------------------------------------------------------- login ---

const lo = await api('POST', '/api/passkey/login/options', { phone: PHONE });
check('login options list the credential', lo.status === 200 && lo.json.allowCredentials.length === 1, JSON.stringify(lo.json));
check('they name the rpId', lo.json.rpId === 'localhost');

// The whole point: the signature authenticates, so the request carries no
// password and no code - only what the authenticator produced.
const assertionBody = auth.assert(lo.json.challenge);
check(
  'the request carries no password or code',
  !('password' in assertionBody) && !('code' in assertionBody),
  Object.keys(assertionBody).join(',')
);
const good = await api('POST', '/api/passkey/login', assertionBody);
check('a valid assertion signs in', good.status === 200 && !!good.json.token && good.json.user.name === 'Aigerim', JSON.stringify(good.json));

// ------------------------------------------------------- the refusals ---

const lo2 = await api('POST', '/api/passkey/login/options', { phone: PHONE });
const tampered = await api('POST', '/api/passkey/login', auth.assert(lo2.json.challenge, { tamper: true }));
check('a tampered signature is refused', tampered.status === 401 && tampered.json.code === 'passkey_invalid', JSON.stringify(tampered.json));

const lo3 = await api('POST', '/api/passkey/login/options', { phone: PHONE });
const wrongOrigin = await api('POST', '/api/passkey/login', auth.assert(lo3.json.challenge, { origin: 'https://evil.example' }));
check('an assertion from another origin is refused', wrongOrigin.status === 401 && wrongOrigin.json.code === 'passkey_invalid');

const invented = await api('POST', '/api/passkey/login', auth.assert('a-challenge-nobody-issued'));
check('a challenge that was never issued is refused', invented.status === 400 && invented.json.code === 'challenge_expired');

const lo4 = await api('POST', '/api/passkey/login/options', { phone: PHONE });
const assertion = auth.assert(lo4.json.challenge);
const first = await api('POST', '/api/passkey/login', assertion);
check('the assertion works once', first.status === 200);
const second = await api('POST', '/api/passkey/login', assertion);
check('and cannot be replayed', second.status === 400 && second.json.code === 'challenge_expired', JSON.stringify(second.json));

// A counter that goes backwards is the signal that a credential was cloned.
const lo5 = await api('POST', '/api/passkey/login/options', { phone: PHONE });
const stale = auth.assert(lo5.json.challenge, { bumpCount: false });
auth.signCount -= 1; // pretend the clone is behind
const cloned = await api('POST', '/api/passkey/login', auth.assert((await api('POST', '/api/passkey/login/options', { phone: PHONE })).json.challenge, { bumpCount: false }));
check('a sign count that does not advance is refused', cloned.status === 401 && cloned.json.code === 'passkey_invalid', JSON.stringify(cloned.json));
auth.signCount += 5; // recover for the remaining checks

// Another account's device must not sign in as this one.
const OTHER = '+77015563002';
const other = await mk(OTHER, 'Dana');
const otherAuth = new VirtualAuthenticator('localhost');
const oOpts = await api('POST', '/api/passkey/register/options', {}, other.token);
await api('POST', '/api/passkey/register', otherAuth.register(oOpts.json.challenge), other.token);
const mixOpts = await api('POST', '/api/passkey/login/options', { phone: PHONE });
const mixed = await api('POST', '/api/passkey/login', otherAuth.assert(mixOpts.json.challenge));
check("another user's passkey cannot sign in here", mixed.status === 401 && mixed.json.code === 'passkey_unknown', JSON.stringify(mixed.json));

const noneYet = await api('POST', '/api/passkey/login/options', { phone: '+77019997777' });
check('an unknown phone 404s', noneYet.status === 404 && noneYet.json.code === 'no_account');

// ------------------------------------------------------------ management ---

const del = await api('DELETE', `/api/passkeys/${encodeURIComponent(list.json.passkeys[0].credentialId)}`, null, me.token);
check('a passkey can be removed', del.status === 200);
const afterDel = await api('POST', '/api/passkey/login/options', { phone: PHONE });
check('login then reports there is none', afterDel.status === 404 && afterDel.json.code === 'no_passkey');

const foreign = await api('DELETE', `/api/passkeys/${encodeURIComponent(b64url(otherAuth.credentialId))}`, null, me.token);
check("you cannot delete someone else's passkey", foreign.status === 404 && foreign.json.code === 'passkey_not_found');

// -------------------------------------------------------------- recovery ---
//
// The phone is the way back in, so resetting the password over it must clear
// the passkeys - otherwise a lost device would still be able to sign in.

const rOpts = await api('POST', '/api/passkey/register/options', {}, other.token);
await api('POST', '/api/passkey/register', otherAuth.register(rOpts.json.challenge), other.token).catch(() => {});
await new Promise((r) => setTimeout(r, 250));
const rr = await api('POST', '/api/reset/request', { phone: OTHER });
await api('POST', '/api/reset/confirm', { phone: OTHER, code: rr.json.devCode, password: 'newpass2026' });
const gone = await api('POST', '/api/passkey/login/options', { phone: OTHER });
check('a password reset removes every passkey', gone.status === 404 && gone.json.code === 'no_passkey', JSON.stringify(gone.json));

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
