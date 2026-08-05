// Milestone-6 smoke test: OTP verification, profile fields, saved places,
// address details, offer replay, validation. Usage: node tests/smoke6.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4106;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data6');

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
            const t = setTimeout(() => rej2(new Error('ws timeout')), timeoutMs);
            waiters.push((m) => {
              clearTimeout(t);
              res2(m);
            });
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

// ---------------------------------------------------------------- OTP flow ---

let rider;
{
  const r = await api('POST', '/api/register', { phone: '+15554440001', password: 'secret9', name: 'Vera Verify' });
  check('register returns verification challenge', r.status === 201 && r.json.needsVerification && /^\d{4}$/.test(r.json.devCode));

  const before = await api('POST', '/api/login', { phone: '+15554440001', password: 'secret9' });
  check('login before verification returns challenge', before.status === 403 && before.json.needsVerification);

  const wrong = await api('POST', '/api/verify', { phone: '+15554440001', code: '0000' === r.json.devCode ? '1111' : '0000' });
  check('wrong code rejected', wrong.status === 400 && wrong.json.code === 'code_wrong');

  const tooSoon = await api('POST', '/api/resend', { phone: '+15554440001' });
  check('resend rate-limited', tooSoon.status === 429 && tooSoon.json.code === 'resend_too_soon');

  const ok = await api('POST', '/api/verify', { phone: '+15554440001', code: r.json.devCode });
  check('correct code verifies and signs in', ok.status === 200 && ok.json.token && ok.json.user.name === 'Vera Verify');
  rider = ok.json;

  const again = await api('POST', '/api/login', { phone: '+15554440001', password: 'secret9' });
  check('login works after verification', again.status === 200 && again.json.token);

  const reReg = await api('POST', '/api/register', { phone: '+15554440001', password: 'other66', name: 'Sneak' });
  check('verified phone cannot re-register', reReg.status === 409 && reReg.json.code === 'phone_taken');

  const resendVerified = await api('POST', '/api/resend', { phone: '+15554440001' });
  check('resend for verified account rejected', resendVerified.status === 400 && resendVerified.json.code === 'already_verified');
}

// ------------------------------------------------------------ profile fields ---

{
  const avatar = 'data:image/jpeg;base64,' + 'A'.repeat(2000);
  const upd = await api('PUT', '/api/me', { about: 'Night owl, friendly rides', email: 'vera@example.com', avatar }, rider.token);
  check('about/email/avatar saved', upd.status === 200 && upd.json.user.about === 'Night owl, friendly rides' && upd.json.user.email === 'vera@example.com' && upd.json.user.avatar === avatar);

  const badEmail = await api('PUT', '/api/me', { email: 'not-an-email' }, rider.token);
  check('bad email rejected', badEmail.status === 400 && badEmail.json.code === 'invalid_email');

  const badAvatar = await api('PUT', '/api/me', { avatar: 'data:text/html;base64,xxxx' }, rider.token);
  check('non-image avatar rejected', badAvatar.status === 400 && badAvatar.json.code === 'invalid_avatar');

  const hugeAvatar = await api('PUT', '/api/me', { avatar: 'data:image/png;base64,' + 'B'.repeat(500000) }, rider.token);
  check('oversized avatar rejected', hugeAvatar.status === 400 && hugeAvatar.json.code === 'avatar_too_large');

  const clearAvatar = await api('PUT', '/api/me', { avatar: null }, rider.token);
  check('avatar can be removed', clearAvatar.status === 200 && clearAvatar.json.user.avatar === null);

  const places = await api('PUT', '/api/me/places', { home: { lat: 51.5, lng: -0.1, address: 'Home Street 1' } }, rider.token);
  check('home place saved', places.status === 200 && places.json.user.places.home.address === 'Home Street 1');

  const work = await api('PUT', '/api/me/places', { work: { lat: 51.52, lng: -0.13, address: 'Work Plaza 7' } }, rider.token);
  check('work place added, home kept', work.json.user.places.home && work.json.user.places.work);

  const badPlace = await api('PUT', '/api/me/places', { home: { lat: 200, lng: 0, address: 'X' } }, rider.token);
  check('out-of-range place rejected', badPlace.status === 400 && badPlace.json.code === 'invalid_place');

  const clear = await api('PUT', '/api/me/places', { home: null }, rider.token);
  check('place can be removed', clear.status === 200 && !clear.json.user.places.home);

  // Public directory hides private data but shows about + avatar.
  const reg2r = await api('POST', '/api/register', { phone: '+15554440002', password: 'secret9', name: 'Paul Peek' });
  const peek = (await api('POST', '/api/verify', { phone: '+15554440002', code: reg2r.json.devCode })).json;
  const pub = await api('GET', `/api/users/${rider.user.id}`, null, peek.token);
  check(
    'public profile: about visible, phone/email/places hidden',
    pub.json.user.about === 'Night owl, friendly rides' && pub.json.user.phone === undefined && pub.json.user.email === undefined && pub.json.user.places === undefined
  );
}

// ------------------------------------- address details + coordinate limits ---

const regD = await api('POST', '/api/register', { phone: '+15554440003', password: 'secret9', name: 'Dora Drive' });
const driver = (await api('POST', '/api/verify', { phone: '+15554440003', code: regD.json.devCode })).json;
await api('PUT', '/api/me/driver', { carMake: 'VW', carModel: 'ID.3', carColor: 'Silver', plate: 'EV 01' }, driver.token);

const rws = await connectWs(rider.token);
await rws.nextOf('hello');

{
  rws.send({ type: 'ride:request', pickup: { lat: 91, lng: 0, address: 'A' }, dest: { lat: 1, lng: 1, address: 'B' } });
  const err = await rws.nextOf('error');
  check('out-of-range coordinates rejected', err.code === 'points_required');
}

// Request BEFORE the driver goes online -> tests offer replay.
let createdRide;
{
  rws.send({
    type: 'ride:request',
    pickup: {
      lat: 51.5, lng: -0.1, address: 'Example Street 10',
      details: { entrance: '2', apartment: '45', floor: '5', intercom: '45K', note: 'Gate code 1234' },
    },
    dest: { lat: 51.52, lng: -0.12, address: 'Target Road 3', details: { entrance: 'B' } },
    comment: 'With a dog',
  });
  const created = await rws.nextOf('ride:created');
  createdRide = created.ride;
  check(
    'address details stored on the ride',
    created.ride.pickupDetails.entrance === '2' && created.ride.pickupDetails.note === 'Gate code 1234' && created.ride.destDetails.entrance === 'B'
  );
}

{
  const dws = await connectWs(driver.token);
  await dws.nextOf('hello');
  dws.send({ type: 'driver:activate', lat: 51.501, lng: -0.101 });
  await dws.nextOf('driver:status');

  // The already-open order must arrive even though the driver came online late.
  const offer = await dws.nextOf('ride:offer');
  check(
    'late-activating driver receives open order (replay)',
    offer.ride.id === createdRide.id && typeof offer.pickupDistanceM === 'number' && offer.ride.pickupDetails.apartment === '45'
  );
  check('replayed offer hides rider contact', offer.rider.phone === undefined && offer.rider.email === undefined);

  // Reconnect while online -> replay again on the fresh socket.
  dws.ws.close();
  const dws2 = await connectWs(driver.token);
  await dws2.nextOf('hello');
  const offer2 = await dws2.nextOf('ride:offer');
  check('reconnecting online driver gets open orders again', offer2.ride.id === createdRide.id);

  // Details flow through accept to the driver's active ride.
  dws2.send({ type: 'ride:accept', rideId: createdRide.id });
  const upd = await dws2.nextOf('ride:update');
  check('accepted ride carries details', upd.ride.pickupDetails.intercom === '45K');
  await rws.nextOf('ride:update');

  rws.send({ type: 'ride:cancel', rideId: createdRide.id });
  await rws.nextOf('ride:cancelled');
  await dws2.nextOf('ride:cancelled');
  dws2.ws.close();
}

rws.ws.close();

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
