// L10 smoke test: Web Push - VAPID key, subscription lifecycle, and a full
// end-to-end encryption check: a fake "browser" subscribes with its own ECDH
// keys, a local catcher receives the POST, and the test DECRYPTS the payload
// per RFC 8291 and verifies the VAPID ES256 signature.
// Usage: node tests/smoke14.mjs

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4114;
const CATCH_PORT = 4115;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data14');

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

// ---- push catcher: pretends to be the browser vendor's push service ----
const caught = []; // { url, headers, body }
let respondWith = 201;
const catcher = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    caught.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(respondWith);
    res.end();
  });
});
await new Promise((r) => catcher.listen(CATCH_PORT, r));

fs.rmSync(DATA_DIR, { recursive: true, force: true });
const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR },
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
  try {
    catcher.close();
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

const reg = async (phone, name) => {
  const r = await api('POST', '/api/register', { phone, password: 'pass1234', name });
  return (await api('POST', '/api/verify', { phone, code: r.json.devCode })).json;
};

const waitFor = async (cond, ms = 4000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return cond();
};

// ---- the fake browser: its own P-256 keys + auth secret ----
const ua = crypto.createECDH('prime256v1');
ua.generateKeys();
const authSecret = crypto.randomBytes(16);
const subscription = {
  endpoint: `http://localhost:${CATCH_PORT}/push/ep1`,
  keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') },
};

function decryptRecord(body) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPub = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const shared = ua.computeSecret(asPub);
  const prk = Buffer.from(
    crypto.hkdfSync(
      'sha256',
      shared,
      authSecret,
      Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]),
      32
    )
  );
  const cek = Buffer.from(crypto.hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const tag = ct.subarray(ct.length - 16);
  const data = ct.subarray(0, ct.length - 16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  let pt = Buffer.concat([decipher.update(data), decipher.final()]);
  // strip the 0x02 record delimiter + any padding
  let end = pt.length - 1;
  while (end >= 0 && pt[end] === 0) end--;
  return pt.subarray(0, end).toString('utf8'); // pt[end] === 0x02 dropped by subarray end
}

// ---- key + subscription API ----
const rider = await reg('+15554440001', 'Nura');
const drv = await reg('+15554440002', 'Dias');
await api('PUT', '/api/me/driver', { carMake: 'Hyundai', carModel: 'Sonata', carColor: 'Grey', plate: 'KZ 555' }, drv.token);

const keyRes = await api('GET', '/api/push/key', null, rider.token);
const rawKey = Buffer.from(keyRes.json.key, 'base64url');
check('VAPID public key is a 65-byte uncompressed P-256 point', rawKey.length === 65 && rawKey[0] === 4);

const subRes = await api('POST', '/api/push/subscribe', { subscription }, rider.token);
check('subscription is accepted', subRes.status === 200);
const badSub = await api('POST', '/api/push/subscribe', { subscription: { nope: 1 } }, rider.token);
check('garbage subscription is rejected', badSub.status === 400);

// ---- ride flow triggers a push to the rider on accept ----
const D = await connectWs(drv.token);
await D.nextOf('hello');
D.send({ type: 'driver:activate', lat: 43.24, lng: 76.89 });
await D.nextOf('driver:status');
const R = await connectWs(rider.token);
await R.nextOf('hello');
R.send({ type: 'ride:request', pickup: { lat: 43.24, lng: 76.89, address: 'A' }, dest: { lat: 43.25, lng: 76.9, address: 'B' } });
const created = (await R.nextOf('ride:created')).ride;
await D.nextOf('ride:offer');
D.send({ type: 'ride:accept', rideId: created.id });
await D.nextOf('ride:update');

await waitFor(() => caught.length >= 1);
check('push POST reached the endpoint on accept', caught.length >= 1);
const msg = caught[0];
check('aes128gcm content encoding declared', msg.headers['content-encoding'] === 'aes128gcm');
check('TTL header present', !!msg.headers.ttl);

// VAPID header + signature verification against the advertised public key
const authz = String(msg.headers.authorization || '');
check('vapid authorization header shape', authz.startsWith('vapid t=') && authz.includes(', k='));
const jwt = authz.slice('vapid t='.length, authz.indexOf(', k='));
const [h, p, sig] = jwt.split('.');
const jwtPayload = JSON.parse(Buffer.from(p, 'base64url').toString());
check('JWT audience is the push origin', jwtPayload.aud === `http://localhost:${CATCH_PORT}`);
const pubKeyObj = crypto.createPublicKey({
  key: {
    kty: 'EC',
    crv: 'P-256',
    x: rawKey.subarray(1, 33).toString('base64url'),
    y: rawKey.subarray(33).toString('base64url'),
  },
  format: 'jwk',
});
const sigOk = crypto.verify(
  'sha256',
  Buffer.from(`${h}.${p}`),
  { key: pubKeyObj, dsaEncoding: 'ieee-p1363' },
  Buffer.from(sig, 'base64url')
);
check('VAPID ES256 signature verifies', sigOk);

// full RFC 8291 decryption with the fake browser's private key
let payload = null;
try {
  payload = JSON.parse(decryptRecord(msg.body));
} catch (e) {}
check('payload decrypts with the browser keys', !!payload, String(payload));
check('decrypted payload is the accept notification', payload && /Водитель найден/.test(payload.title));

// ---- dead subscription cleanup on 410 ----
respondWith = 410;
const before = caught.length;
D.send({ type: 'ride:arrived', rideId: created.id });
await D.nextOf('ride:update');
await waitFor(() => caught.length > before);
check('arrived push was attempted', caught.length > before);
await new Promise((r) => setTimeout(r, 300));
const after410 = caught.length;
respondWith = 201;
D.send({ type: 'ride:start', rideId: created.id });
await D.nextOf('ride:update');
D.send({ type: 'ride:finish', rideId: created.id });
await D.nextOf('ride:update');
await new Promise((r) => setTimeout(r, 700));
check('410 pruned the subscription (no further pushes)', caught.length === after410);

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
