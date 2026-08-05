// Milestone-2 smoke test: geo proxy, ride request/cancel, nearby-driver feed.
// Self-contained: spawns a mock OpenStreetMap upstream and the server itself.
// Usage: node tests/smoke2.mjs

import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4102;
const MOCK_PORT = 4109;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data');

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

// ---------------------------------------------------------- mock upstream ---

const mock = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/reverse') {
    res.end(JSON.stringify({ display_name: '10, Example Street, Testville, TE5 7AB, Nowhere' }));
  } else if (url.pathname === '/search') {
    res.end(
      JSON.stringify([
        { lat: '51.5', lon: '-0.1', display_name: 'Example Road, Testville, Nowhere, Planet' },
      ])
    );
  } else if (url.pathname.startsWith('/route/v1/driving/')) {
    res.end(
      JSON.stringify({
        code: 'Ok',
        routes: [
          {
            distance: 3456.7,
            duration: 543.2,
            geometry: { coordinates: [[-0.1, 51.5], [-0.11, 51.51], [-0.12, 51.52]] },
          },
        ],
      })
    );
  } else {
    res.statusCode = 404;
    res.end('{}');
  }
});
await new Promise((r) => mock.listen(MOCK_PORT, r));

// ------------------------------------------------------------ real server ---

fs.rmSync(DATA_DIR, { recursive: true, force: true });
const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR,
    NOMINATIM_URL: `http://localhost:${MOCK_PORT}`,
    OSRM_URL: `http://localhost:${MOCK_PORT}`,
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
  server.stderr.on('data', () => {});
});

const cleanup = () => {
  try {
    server.kill();
  } catch {}
  try {
    mock.close();
  } catch {}
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
};
process.on('exit', cleanup);

// ------------------------------------------------------------------ tests ---

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
const rider = await reg('+15550000001', 'Rita Rider');
const driver = await reg('+15550000002', 'Dave Driver');
await api('PUT', '/api/me/driver', { carMake: 'Skoda', carModel: 'Octavia', carColor: 'White', plate: 'DR1 VER' }, driver.token);

// geo proxy
{
  const rev = await api('GET', '/api/geo/reverse?lat=51.5&lng=-0.1', null, rider.token);
  check('geo reverse via proxy', rev.status === 200 && rev.json.address === '10, Example Street, Testville', JSON.stringify(rev.json));

  const search = await api('GET', '/api/geo/search?q=example&lat=51.5&lng=-0.1', null, rider.token);
  check('geo search via proxy', search.status === 200 && search.json.results.length === 1 && search.json.results[0].lat === 51.5);

  const route = await api('GET', '/api/geo/route?fromLat=51.5&fromLng=-0.1&toLat=51.52&toLng=-0.12', null, rider.token);
  check(
    'geo route via proxy (latlng order + rounding)',
    route.status === 200 &&
      route.json.distanceM === 3457 &&
      route.json.durationS === 543 &&
      route.json.points.length === 3 &&
      route.json.points[0][0] === 51.5 &&
      route.json.points[0][1] === -0.1,
    JSON.stringify(route.json)
  );

  const noauth = await api('GET', '/api/geo/reverse?lat=1&lng=2');
  check('geo requires auth', noauth.status === 401);
}

// driver online + rider map watch
const dws = await connectWs(driver.token);
await dws.nextOf('hello');
dws.send({ type: 'driver:activate', lat: 51.501, lng: -0.101 });
await dws.nextOf('driver:status');

const rws = await connectWs(rider.token);
{
  const hello = await rws.nextOf('hello');
  check('rider hello has no active ride', hello.activeRide === null);

  rws.send({ type: 'map:watch', lat: 51.5, lng: -0.1 });
  const feed = await rws.nextOf('map:drivers');
  check('nearby driver appears on map feed', feed.drivers.length === 1 && feed.drivers[0].id === driver.user.id, JSON.stringify(feed));

  rws.send({ type: 'map:watch', lat: 40.0, lng: 30.0 }); // far away
  const feed2 = await rws.nextOf('map:drivers');
  check('far-away watcher sees no drivers', feed2.drivers.length === 0);
  rws.send({ type: 'map:unwatch' });
}

// ride request -> offer -> cancel
{
  rws.send({
    type: 'ride:request',
    pickup: { lat: 51.5, lng: -0.1, address: 'Example Street 10' },
    dest: { lat: 51.52, lng: -0.12, address: 'Example Road 2' },
    comment: 'Blue jacket, by the pharmacy',
    distanceM: 3457,
    durationS: 543,
    reqId: 'r1',
  });
  const created = await rws.nextOf('ride:created');
  check('ride created', created.ride.status === 'requested' && created.ride.comment === 'Blue jacket, by the pharmacy');

  const offer = await dws.nextOf('ride:offer');
  check(
    'driver received offer with rider info + distance',
    offer.ride.id === created.ride.id && offer.rider.name === 'Rita Rider' && offer.rider.phone === undefined && typeof offer.pickupDistanceM === 'number',
    JSON.stringify(offer).slice(0, 200)
  );

  const dup = await api('GET', '/api/me', null, rider.token);
  check('active ride visible in /api/me', dup.json.activeRide && dup.json.activeRide.id === created.ride.id);

  rws.send({ type: 'ride:request', pickup: { lat: 1, lng: 1 }, dest: { lat: 2, lng: 2 } });
  const err = await rws.nextOf('error');
  check('second simultaneous ride rejected', /active ride/i.test(err.message));

  rws.send({ type: 'ride:cancel', rideId: created.ride.id });
  const cancelled = await rws.nextOf('ride:cancelled');
  check('rider cancels ride', cancelled.ride.status === 'cancelled' && cancelled.ride.cancelledBy === 'rider');

  const gone = await dws.nextOf('ride:offer_gone');
  check('drivers told the offer is gone', gone.rideId === created.ride.id);

  const me2 = await api('GET', '/api/me', null, rider.token);
  check('no active ride after cancel', me2.json.activeRide === null);
}

// missing coordinates rejected
{
  rws.send({ type: 'ride:request', pickup: { lat: 51.5 }, dest: { lat: 2, lng: 2 } });
  const err = await rws.nextOf('error');
  check('incomplete pickup rejected', /required/i.test(err.message));
}

rws.ws.close();
dws.ws.close();

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
