// Milestone-3 smoke test: driver order feed, first-accept-wins matching,
// counterpart phone reveal, live driver location relay.
// Usage: node tests/smoke3.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4103;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data3');

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

const reg = async (phone, name) => {
  const r = await api('POST', '/api/register', { phone, password: 'pass1234', name });
  return (await api('POST', '/api/verify', { phone, code: r.json.devCode })).json;
};

const rider = await reg('+15551110001', 'Rita Rider');
const drv1 = await reg('+15551110002', 'Dave Driver');
const drv2 = await reg('+15551110003', 'Dina Driver');
await api('PUT', '/api/me/driver', { carMake: 'VW', carModel: 'Golf', carColor: 'Black', plate: 'D1' }, drv1.token);
await api('PUT', '/api/me/driver', { carMake: 'Kia', carModel: 'Rio', carColor: 'Red', plate: 'D2' }, drv2.token);

const d1 = await connectWs(drv1.token);
await d1.nextOf('hello');
d1.send({ type: 'driver:activate', lat: 51.5, lng: -0.1 });
await d1.nextOf('driver:status');

const d2 = await connectWs(drv2.token);
await d2.nextOf('hello');
d2.send({ type: 'driver:activate', lat: 51.51, lng: -0.11 });
await d2.nextOf('driver:status');

const r = await connectWs(rider.token);
await r.nextOf('hello');

// request -> both drivers get the offer
r.send({
  type: 'ride:request',
  pickup: { lat: 51.5, lng: -0.1, address: 'Pickup St 1' },
  dest: { lat: 51.52, lng: -0.12, address: 'Dest Rd 2' },
  comment: 'ring the bell',
});
const created = (await r.nextOf('ride:created')).ride;
const off1 = await d1.nextOf('ride:offer');
const off2 = await d2.nextOf('ride:offer');
check('both online drivers got the offer', off1.ride.id === created.id && off2.ride.id === created.id);
check('offer hides rider phone', off1.rider.phone === undefined);

// driver 1 accepts
d1.send({ type: 'ride:accept', rideId: created.id, reqId: 'a1' });
const dUpd = await d1.nextOf('ride:update');
check(
  'accepting driver gets ride + rider contact',
  dUpd.ride.status === 'accepted' && dUpd.ride.driverId === drv1.user.id && dUpd.counterpart.phone === '+15551110001',
  JSON.stringify(dUpd).slice(0, 200)
);
const rUpd = await r.nextOf('ride:update');
check(
  'rider gets driver info with phone, car and location',
  rUpd.ride.status === 'accepted' &&
    rUpd.counterpart.phone === '+15551110002' &&
    rUpd.counterpart.car.plate === 'D1' &&
    rUpd.driverLocation && rUpd.driverLocation.lat === 51.5,
  JSON.stringify(rUpd).slice(0, 300)
);
const gone2 = await d2.nextOf('ride:offer_gone');
check('other driver told offer is gone', gone2.rideId === created.id);

// driver 2 tries to accept the same ride
d2.send({ type: 'ride:accept', rideId: created.id, reqId: 'a2' });
const err2 = await d2.nextOf('error');
check('second accept rejected as taken', err2.code === 'taken');

// live location relay to rider
d1.send({ type: 'driver:location', lat: 51.505, lng: -0.105 });
const relay = await r.nextOf('ride:driver_location');
check('driver movement relayed to rider', relay.rideId === created.id && relay.lat === 51.505);

// a busy driver may now take another order (convoy, since L7)
r.send({ type: 'ride:cancel', rideId: 'nonexistent' });
await r.nextOf('error');
const rider2 = await reg('+15551110004', 'Rob Rider');
const r2 = await connectWs(rider2.token);
await r2.nextOf('hello');
r2.send({ type: 'ride:request', pickup: { lat: 51.5, lng: -0.1, address: 'A' }, dest: { lat: 51.51, lng: -0.11, address: 'B' } });
const created2 = (await r2.nextOf('ride:created')).ride;
await d2.nextOf('ride:offer');
d1.send({ type: 'ride:accept', rideId: created2.id });
const convoyUpd = await d1.nextOf('ride:update');
check('driver with active ride can convoy a second one', convoyUpd.ride.id === created2.id && convoyUpd.ride.status === 'accepted');
const meConvoy = await api('GET', '/api/me', null, drv1.token);
check('/api/me lists both convoy rides', (meConvoy.json.driverRides || []).length === 2);
// hand the second ride back so the rest of the flow stays as before
d1.send({ type: 'ride:cancel', rideId: created2.id });
await d1.nextOf('ride:cancelled');

// reconnect mid-ride: hello carries ride + counterpart
const rReconnect = await connectWs(rider.token);
const hello2 = await rReconnect.nextOf('hello');
check(
  'reconnect hello restores ride, counterpart and driver location',
  hello2.activeRide && hello2.activeRide.id === created.id && hello2.counterpart.id === drv1.user.id && hello2.driverLocation.lat === 51.505
);
rReconnect.ws.close();

// /api/me exposes counterpart too
const me = await api('GET', '/api/me', null, rider.token);
check('/api/me exposes counterpart with phone', me.json.counterpart && me.json.counterpart.phone === '+15551110002');

// rider cancels the accepted ride -> driver notified, becomes free
r.send({ type: 'ride:cancel', rideId: created.id });
const c1 = await r.nextOf('ride:cancelled');
const c2 = await d1.nextOf('ride:cancelled');
check('both sides notified of cancel', c1.ride.id === created.id && c2.ride.id === created.id && c2.ride.cancelledBy === 'rider');

// driver 1 is free again and can accept a fresh open order
r2.send({ type: 'ride:request', pickup: { lat: 51.5, lng: -0.1, address: 'A' }, dest: { lat: 51.51, lng: -0.11, address: 'B' } });
const created2b = (await r2.nextOf('ride:created')).ride;
d1.send({ type: 'ride:accept', rideId: created2b.id });
const upd2 = await d1.nextOf('ride:update');
check('freed driver can accept the next order', upd2.ride.id === created2b.id && upd2.ride.status === 'accepted');

// non-driver cannot accept
r2.send({ type: 'ride:cancel', rideId: created2b.id });
await r2.nextOf('ride:cancelled');
await d1.nextOf('ride:cancelled');
r2.send({ type: 'ride:request', pickup: { lat: 51.5, lng: -0.1, address: 'A' }, dest: { lat: 51.51, lng: -0.11, address: 'B' } });
const created3 = (await r2.nextOf('ride:created')).ride;
r.send({ type: 'ride:accept', rideId: created3.id });
const errNotDriver = await r.nextOf('error');
check('non-driver cannot accept orders', /only drivers/i.test(errNotDriver.message));

r.ws.close();
r2.ws.close();
d1.ws.close();
d2.ws.close();

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
