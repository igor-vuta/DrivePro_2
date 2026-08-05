// Milestone-4 smoke test: ride status flow arrived -> start -> finish,
// cancel rules, history. Usage: node tests/smoke4.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4104;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data4');

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

const rider = await reg('+15552220001', 'Rita Rider');
const drv = await reg('+15552220002', 'Dave Driver');
await api('PUT', '/api/me/driver', { carMake: 'VW', carModel: 'Golf', carColor: 'Black', plate: 'D1' }, drv.token);

const d = await connectWs(drv.token);
await d.nextOf('hello');
d.send({ type: 'driver:activate', lat: 51.5, lng: -0.1 });
await d.nextOf('driver:status');

const r = await connectWs(rider.token);
await r.nextOf('hello');

r.send({
  type: 'ride:request',
  pickup: { lat: 51.5, lng: -0.1, address: 'A st' },
  dest: { lat: 51.52, lng: -0.12, address: 'B rd' },
});
const ride = (await r.nextOf('ride:created')).ride;
await d.nextOf('ride:offer');

// rider cannot drive the status machine
r.send({ type: 'ride:arrived', rideId: ride.id });
check('rider cannot mark arrived', (await r.nextOf('error')).message === 'No such ride.');

// driver cannot start before accepting
d.send({ type: 'ride:start', rideId: ride.id });
check('start before accept rejected', /no such ride/i.test((await d.nextOf('error')).message));

d.send({ type: 'ride:accept', rideId: ride.id });
await d.nextOf('ride:update');
await r.nextOf('ride:update');

// finish before start rejected
d.send({ type: 'ride:finish', rideId: ride.id });
check('finish before start rejected', /can't do that/i.test((await d.nextOf('error')).message));

// arrived
d.send({ type: 'ride:arrived', rideId: ride.id });
const dArr = await d.nextOf('ride:update');
const rArr = await r.nextOf('ride:update');
check('arrived propagated to both', dArr.ride.status === 'arrived' && rArr.ride.status === 'arrived' && dArr.ride.arrivedAt > 0);

// rider can still cancel at "arrived"... but we test the driver flow, so continue.
// double-arrived rejected
d.send({ type: 'ride:arrived', rideId: ride.id });
check('double arrived rejected', /can't do that/i.test((await d.nextOf('error')).message));

// start
d.send({ type: 'ride:start', rideId: ride.id });
const dStart = await d.nextOf('ride:update');
const rStart = await r.nextOf('ride:update');
check('trip started on both sides', dStart.ride.status === 'in_progress' && rStart.ride.status === 'in_progress');

// cancel mid-trip rejected for both sides
r.send({ type: 'ride:cancel', rideId: ride.id });
check('rider cannot cancel mid-trip', /can't be cancelled/i.test((await r.nextOf('error')).message));
d.send({ type: 'ride:cancel', rideId: ride.id });
check('driver cannot cancel mid-trip', /can't be cancelled/i.test((await d.nextOf('error')).message));

// driver location still relayed mid-trip
d.send({ type: 'driver:location', lat: 51.515, lng: -0.115 });
check('location relayed mid-trip', (await r.nextOf('ride:driver_location')).lat === 51.515);

// finish
d.send({ type: 'ride:finish', rideId: ride.id });
const dFin = await d.nextOf('ride:update');
const rFin = await r.nextOf('ride:update');
check('finished on both sides with timestamps', dFin.ride.status === 'finished' && rFin.ride.finishedAt > 0);

// no more active ride; driver still online and can get new offers
const me = await api('GET', '/api/me', null, rider.token);
check('rider has no active ride after finish', me.json.activeRide === null);
const meD = await api('GET', '/api/me', null, drv.token);
check('driver still online after finish', meD.json.driverActive === true);

r.send({
  type: 'ride:request',
  pickup: { lat: 51.5, lng: -0.1, address: 'A st' },
  dest: { lat: 51.51, lng: -0.11, address: 'C rd' },
});
await r.nextOf('ride:created');
check('driver receives next offer after finishing', (await d.nextOf('ride:offer')).ride.destAddress === 'C rd');

// history shows both rides
const hist = await api('GET', '/api/rides', null, rider.token);
check('history lists rides', hist.json.rides.length === 2 && hist.json.rides.some((x) => x.status === 'finished'));

// start directly from accepted (skipping arrived) works
const d2ride = hist.json.rides.find((x) => x.status === 'requested');
d.send({ type: 'ride:accept', rideId: d2ride.id });
await d.nextOf('ride:update');
await r.nextOf('ride:update');
d.send({ type: 'ride:start', rideId: d2ride.id });
check('start straight from accepted allowed', (await d.nextOf('ride:update')).ride.status === 'in_progress');
await r.nextOf('ride:update');
d.send({ type: 'ride:finish', rideId: d2ride.id });
await d.nextOf('ride:update');
await r.nextOf('ride:update');

r.ws.close();
d.ws.close();

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
