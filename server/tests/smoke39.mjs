// L56 smoke test: a route request that used to come back as a straight line.
//
// When a point lands somewhere the chosen profile cannot start from - a
// building, the middle of a park, a motorway a pedestrian may not walk on -
// OSRM answers "no route", the proxy answered 502, and the app drew a straight
// line across the city. A straight line is not a route; it is the app
// pretending. So the proxy now repairs the request instead of refusing it.
//
// Pinned here:
//   - a point the profile cannot route from is moved to the nearest point it
//     can, via OSRM's own nearest service, and the route is retried
//   - where the point moved to comes back in the answer, so the app can show
//     it rather than quietly lying about where you are walking from
//   - a correction of a metre or two is not worth a second request
//   - when a profile genuinely cannot answer, another profile does, and says
//     so as viaMode - a cycling route beats a straight line
//   - when nothing can answer, it is still an error and not an invention
// Usage: node tests/smoke39.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Not 4190: fetch() refuses it outright ("bad port") because the WHATWG spec
// blocks the ManageSieve port, which costs a confusing half hour to discover.
const PORT = 4196;
const FOOT_PORT = 4191;
const BIKE_PORT = 4192;
const CAR_PORT = 4193;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data39');

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

const routeBody = (snapM = 3) =>
  JSON.stringify({
    code: 'Ok',
    routes: [
      {
        distance: 3000,
        duration: 2400,
        geometry: { coordinates: [[76.89, 43.24], [76.9, 43.25], [76.91, 43.26]] },
      },
    ],
    waypoints: [{ distance: snapM }, { distance: snapM }],
  });

// The foot stub refuses anything starting at latitude 43.99 - "you are in the
// middle of a park" - but its nearest service will happily point at the path
// 40 m away, and it routes fine from there.
const REFUSED_LAT = '43.99';
// A second scripted latitude where nothing walking or driving can help at all:
// the route is refused AND the nearest service has nothing to offer. That is
// the case where another profile has to answer or the app gets a straight line.
const HOPELESS_LAT = '43.88';
const NEAREST_LAT = 43.2905;
const NEAREST_LNG = 76.9231;
const seen = { foot: [], bike: [], car: [], nearest: [] };

const latOf = (url) => {
  const m = url.match(/\/v1\/[a-z]+\/([-0-9.]+),([-0-9.]+)/);
  return m ? m[2] : '';
};

// refuseRoute / refuseNearest are lists of latitude prefixes the stub pretends
// it cannot serve, which is how each scenario is scripted without three
// different stub implementations.
const stub = (name, port, opts = {}) => {
  const refuseRoute = opts.refuseRoute || [];
  const refuseNearest = opts.refuseNearest || [];
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const lat = latOf(req.url);
    if (req.url.startsWith('/nearest/')) {
      seen.nearest.push(`${name}:${req.url}`);
      if (refuseNearest.some((pre) => lat.startsWith(pre))) {
        res.end(JSON.stringify({ code: 'NoSegment' }));
        return;
      }
      res.end(
        JSON.stringify({
          code: 'Ok',
          waypoints: [{ location: [NEAREST_LNG, NEAREST_LAT], distance: 41.7 }],
        })
      );
      return;
    }
    seen[name].push(req.url);
    if (refuseRoute.some((pre) => lat.startsWith(pre))) {
      res.end(JSON.stringify({ code: 'NoRoute', routes: [] }));
      return;
    }
    res.end(routeBody());
  });
  return new Promise((r) => srv.listen(port, () => r(srv)));
};

// Walking is refused in both scripted places; only in the first can the
// nearest service rescue it. Driving is refused in the hopeless one too - it
// doubles as the worldwide fallback here - leaving cycling as the only
// profile that can answer.
const footSrv = await stub('foot', FOOT_PORT, { refuseRoute: [REFUSED_LAT, HOPELESS_LAT], refuseNearest: [HOPELESS_LAT] });
const bikeSrv = await stub('bike', BIKE_PORT);
const carSrv = await stub('car', CAR_PORT, { refuseRoute: [HOPELESS_LAT], refuseNearest: [HOPELESS_LAT] });

fs.rmSync(DATA_DIR, { recursive: true, force: true });

const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR,
    NODE_ENV: 'test',
    OSRM_URL: `http://localhost:${CAR_PORT}`,
    OSRM_FOOT_URL: `http://localhost:${FOOT_PORT}`,
    OSRM_BIKE_URL: `http://localhost:${BIKE_PORT}`,
    // Every fallback points at the same stubs, so nothing in this test can
    // reach the real FOSSGIS servers.
    OSRM_FALLBACK_URL: `http://localhost:${CAR_PORT}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start')), 10000);
  let out = '';
  server.stdout.on('data', (d) => {
    out += String(d);
    if (out.includes('running')) {
      clearTimeout(t);
      resolve();
    }
  });
});

const cleanup = () => {
  try {
    server.kill();
    footSrv.close();
    bikeSrv.close();
    carSrv.close();
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
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

const reg = await api('POST', '/api/register', { phone: '+77015600001', password: 'almaty2026', name: 'Aisha' });
const user = (await api('POST', '/api/verify', { phone: '+77015600001', code: reg.json.devCode })).json;

// ---- a point no pedestrian can start from is moved, not refused ----
{
  const r = await api(
    'GET',
    `/api/geo/route?fromLat=${REFUSED_LAT}00&fromLng=76.8897&toLat=43.2567&toLng=76.9286&mode=foot`,
    null,
    user.token
  );
  check('a point the profile cannot use still produces a route', r.status === 200 && r.json.points && r.json.points.length >= 2, `${r.status} ${r.text.slice(0, 120)}`);
  check('...it is still reported as the walking route that was asked for', r.json && r.json.mode === 'foot' && !r.json.viaMode, JSON.stringify(r.json && r.json.mode));
  check('...the nearest service was consulted', seen.nearest.some((u) => u.startsWith('foot:')), seen.nearest.join(' '));
  check(
    '...and the app is told where the start actually moved to',
    r.json.snapped && r.json.snapped.from && Math.abs(r.json.snapped.from.lat - NEAREST_LAT) < 1e-6 && r.json.snapped.from.movedM === 42,
    JSON.stringify(r.json.snapped)
  );
}

// ---- a two-metre correction is not worth a second request ----
{
  const bikeBefore = seen.nearest.length;
  const r = await api('GET', '/api/geo/route?fromLat=43.2389&fromLng=76.8897&toLat=43.2567&toLng=76.9286&mode=bike', null, user.token);
  check('a route that works is not "repaired"', r.status === 200 && !r.json.snapped, JSON.stringify(r.json && r.json.snapped));
  check('...and nothing extra was asked of the router', seen.nearest.length === bikeBefore, `${seen.nearest.length - bikeBefore} extra calls`);
}

// ---- when walking truly cannot answer, cycling does - and says so ----
{
  const r = await api(
    'GET',
    `/api/geo/route?fromLat=${HOPELESS_LAT}00&fromLng=76.8897&toLat=43.2567&toLng=76.9286&mode=foot`,
    null,
    user.token
  );
  check('a profile that cannot answer hands over to one that can', r.status === 200 && r.json.points && r.json.points.length >= 2, `${r.status} ${r.text.slice(0, 120)}`);
  check('...and admits which profile actually answered', r.json && r.json.viaMode === 'bike', JSON.stringify(r.json && { mode: r.json.mode, viaMode: r.json.viaMode }));
  check('...while still reporting the mode that was asked for', r.json && r.json.mode === 'foot', JSON.stringify(r.json && r.json.mode));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
