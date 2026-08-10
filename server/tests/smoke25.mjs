// L24 smoke test: native (Expo) push alongside Web Push.
//
// Native builds have no service worker, so they register an Expo push token
// instead and the server relays through Expo. Both kinds share the push_subs
// table - an Expo token stands in for the endpoint - so the risks worth
// pinning are: the two shapes are validated differently, a notification fans
// out to BOTH transports, and only a permanent Expo error prunes a token (a
// transient Expo outage must not wipe everyone's subscriptions).
//
// EXPO_PUSH_URL points at a stub in this suite, so nothing reaches Expo.
// Usage: node tests/smoke25.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4138;
const EXPO_PORT = 4139;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data25');

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

// ---- stub Expo push service ----
let expoRequests = [];
let expoReply = (messages) => ({ data: messages.map(() => ({ status: 'ok', id: 'ticket' })) });
let expoStatus = 200;
const expo = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const messages = JSON.parse(body || '[]');
    expoRequests.push(messages);
    if (expoStatus !== 200) {
      res.writeHead(expoStatus);
      res.end('nope');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(expoReply(messages)));
  });
});
await new Promise((r) => expo.listen(EXPO_PORT, r));

// The stub has to be in force for THIS process too: the pruning checks below
// import push.js directly, and without this they would fall through to the
// real Expo service - which answers DeviceNotRegistered for a made-up token
// and would quietly overrule every stubbed reply.
process.env.EXPO_PUSH_URL = `http://localhost:${EXPO_PORT}/send`;

fs.rmSync(DATA_DIR, { recursive: true, force: true });
const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR,
    EXPO_PUSH_URL: `http://localhost:${EXPO_PORT}/send`,
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
  try {
    expo.close();
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
const reg = async (phone, name) => {
  const r = await api('POST', '/api/register', { phone, password: 'pass1234', name });
  return (await api('POST', '/api/verify', { phone, code: r.json.devCode })).json;
};

const rider = await reg('+77015557001', 'Aigerim');
const driver = await reg('+77015557002', 'Dana');
await api('PUT', '/api/me/driver', { carMake: 'Toyota', carModel: 'Camry', carColor: 'White', plate: '777 ABC 02' }, driver.token);

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN_B = 'ExpoPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
const sub = (subscription, tok) => api('POST', '/api/push/subscribe', { subscription }, tok);

// ---------------------------------------------------- shape validation ---

check('an Expo token is accepted', (await sub({ kind: 'expo', endpoint: TOKEN_A }, rider.token)).status === 200);
check('the short-form token name is accepted', (await sub({ kind: 'expo', endpoint: TOKEN_B }, driver.token)).status === 200);

const junk = await sub({ kind: 'expo', endpoint: 'not-a-token' }, rider.token);
check('a malformed Expo token is rejected', junk.status === 400, String(junk.status));

// A web subscription still needs its encryption keys - the expo branch must
// not have loosened that.
const webNoKeys = await sub({ endpoint: 'https://push.example/abc' }, rider.token);
check('a web subscription without keys is still rejected', webNoKeys.status === 400, String(webNoKeys.status));
const webOk = await sub(
  { endpoint: 'https://push.example/abc', keys: { p256dh: 'BPd'.padEnd(87, 'x'), auth: 'abcdefghijklmnop' } },
  rider.token
);
check('a complete web subscription is still accepted', webOk.status === 200);

// ------------------------------------------------------------- delivery ---
// A ride offer notifies the driver; the driver holds an Expo token.

expoRequests = [];
const A = { lat: 43.24, lng: 76.89, address: 'Абая 150' };
const B = { lat: 43.25, lng: 76.9, address: 'Достык 91' };
const ws = new globalThis.WebSocket(`ws://localhost:${PORT}/ws?token=${encodeURIComponent(driver.token)}`);
await new Promise((r) => (ws.onopen = r));
ws.send(JSON.stringify({ type: 'driver:activate', lat: 43.24, lng: 76.89 }));
await sleep(300);

const rws = new globalThis.WebSocket(`ws://localhost:${PORT}/ws?token=${encodeURIComponent(rider.token)}`);
await new Promise((r) => (rws.onopen = r));
rws.send(JSON.stringify({ type: 'ride:request', pickup: A, dest: B, comment: '', distanceM: 2400, durationS: 480, routePoints: null }));
await sleep(700);

check('the offer reached the Expo stub', expoRequests.length >= 1, `${expoRequests.length} requests`);
const sent = expoRequests.flat();
check('it was addressed to the driver token', sent.some((m) => m.to === TOKEN_B), JSON.stringify(sent.map((m) => m.to)));
check('it carries a title and body', sent.every((m) => typeof m.title === 'string' && typeof m.body === 'string'));

// --------------------------------------------------------------- pruning ---

// Pruning semantics are checked on a user with no ride activity: the server
// pushes to the driver on its own schedule, and a stray notification landing
// while the stub is primed with an error would prune the token behind us.
const { pushToUser } = await import('../src/push.js');
const { Store } = await import('../src/store.js');
const quiet = await reg('+77015557003', 'Timur');
const QUIET_TOKEN = 'ExponentPushToken[cccccccccccccccccccccc]';
await sub({ kind: 'expo', endpoint: QUIET_TOKEN }, quiet.token);

const beforeStub = expoRequests.length;
const store = new Store(DATA_DIR);
const quietId = store.findUserByPhone('+77015557003').id;
const hasExpo = () => new Store(DATA_DIR).pushSubsFor(quietId).some((s) => s.kind === 'expo');
check('the Expo subscription is stored', hasExpo());

// Not permanent - Expo may just be rate limiting us. Keep the token.
expoReply = () => ({ data: [{ status: 'error', message: 'slow down', details: { error: 'MessageRateExceeded' } }] });
pushToUser(store, quietId, { title: 'x', body: 'y' });
await sleep(400);
check('a non-permanent Expo error keeps the token', hasExpo());

// A total Expo outage must not invalidate anyone either.
expoStatus = 503;
pushToUser(store, quietId, { title: 'x', body: 'y' });
await sleep(400);
expoStatus = 200;
check('an Expo outage keeps the token', hasExpo());

// DeviceNotRegistered is permanent: the app was uninstalled, drop it.
expoReply = () => ({ data: [{ status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }] });
pushToUser(store, quietId, { title: 'x', body: 'y' });
await sleep(400);
check('DeviceNotRegistered prunes the token', !hasExpo());
check('every pruning push went to the stub, not the real Expo', expoRequests.length - beforeStub === 3, `${expoRequests.length - beforeStub} stub hits`);

// ------------------------------------------------ the client registration ---
//
// Metro folds Platform.OS on web, so the native branch is dead-code-eliminated
// from the web bundle - the export can never fail on a syntax error in it, and
// nothing else compiles this file until an EAS build runs. Parse it here.
const clientPush = path.join(__dirname, '..', '..', 'app', 'src', 'push.js');
const src = fs.readFileSync(clientPush, 'utf8');
const tmp = path.join(__dirname, '.tmp-push-check.mjs');
fs.writeFileSync(tmp, src);
const parse = spawn(process.execPath, ['--check', tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
let parseErr = '';
parse.stderr.on('data', (d) => (parseErr += d));
const parseCode = await new Promise((r) => parse.on('exit', r));
fs.rmSync(tmp, { force: true });
check('the client push module parses', parseCode === 0, parseErr.split('\n')[0] || '');

check('web still registers through PushManager', /reg\.pushManager\.subscribe/.test(src));
check('native registers an Expo token', /getExpoPushTokenAsync/.test(src));
const calls = (src.match(/api\('POST', '\/api\/push\/subscribe'/g) || []).length;
check('both transports post to the same endpoint', calls === 2, `${calls} call sites`);
check('the native branch marks its kind', /kind: 'expo'/.test(src));
// Importing expo-notifications statically would drag it into the web bundle.
check('expo-notifications is imported dynamically', /await import\('expo-notifications'\)/.test(src));
check('no static expo-notifications import', !/^import .*expo-notifications/m.test(src));

try {
  ws.close();
  rws.close();
} catch {}

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
