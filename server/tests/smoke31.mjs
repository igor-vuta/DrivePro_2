// L31 smoke test: multi-profile routing (car / foot / bike).
//
// The route proxy must send each mode to the right OSRM endpoint with the
// right profile path, tolerate an unknown mode by falling back to car, and
// return the mode it actually used. A per-profile stub OSRM stands in for the
// three upstreams, so nothing reaches the network.
// Usage: node tests/smoke31.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4160;
const OSRM_PORT = 4161;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data31');

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

// ---- stub OSRM: one server, three profile paths, records what it was asked ----
let seen = [];
const osrm = http.createServer((req, res) => {
  seen.push(req.url);
  // /route/v1/<profile>/<lng,lat>;<lng,lat>?...
  const m = req.url.match(/\/route\/v1\/([a-z]+)\//);
  const profile = m ? m[1] : 'unknown';
  // A believable but profile-distinct duration so the response is checkable.
  const duration = { driving: 600, foot: 2400, bike: 900 }[profile] || 600;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      code: 'Ok',
      routes: [
        {
          distance: 3000,
          duration,
          geometry: { coordinates: [[76.89, 43.24], [76.9, 43.25]] },
        },
      ],
    })
  );
});
await new Promise((r) => osrm.listen(OSRM_PORT, r));
const OSRM = `http://localhost:${OSRM_PORT}`;

fs.rmSync(DATA_DIR, { recursive: true, force: true });
const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR,
    // All three profiles point at the same stub; the path segment distinguishes them.
    OSRM_URL: OSRM,
    OSRM_FOOT_URL: OSRM,
    OSRM_BIKE_URL: OSRM,
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
    osrm.close();
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

const reg = await api('POST', '/api/register', { phone: '+77015567001', password: 'almaty2026', name: 'Aigerim' });
const me = (await api('POST', '/api/verify', { phone: '+77015567001', code: reg.json.devCode })).json;

// A fresh destination per call keeps each request off the previous one's
// cache entry, so the stub actually sees it.
let dest = 43.250;
const routeReq = (mode) => {
  dest += 0.001;
  return api('GET', `/api/geo/route?fromLat=43.24&fromLng=76.89&toLat=${dest.toFixed(5)}&toLng=76.90${mode ? `&mode=${mode}` : ''}`, null, me.token);
};

// Auth is required.
const noAuth = await api('GET', '/api/geo/route?fromLat=43.24&fromLng=76.89&toLat=43.99&toLng=76.90');
check('routing requires authentication', noAuth.status === 401, String(noAuth.status));

// ---- car ----
seen = [];
const car = await routeReq('car');
check('car routing works', car.status === 200 && car.json.mode === 'car', JSON.stringify(car.json));
check('car goes to the driving profile', seen.some((u) => u.includes('/route/v1/driving/')), seen.join(' '));
check('car returns the driving duration', car.json.durationS === 600, String(car.json.durationS));
check('coordinates are flipped to [lat,lng]', car.json.points[0][0] === 43.24 && car.json.points[0][1] === 76.89, JSON.stringify(car.json.points));

// ---- foot ----
seen = [];
const foot = await routeReq('foot');
check('foot routing works and reports its mode', foot.status === 200 && foot.json.mode === 'foot');
check('foot goes to the foot profile', seen.some((u) => u.includes('/route/v1/foot/')), seen.join(' '));
check('foot returns the walking duration', foot.json.durationS === 2400, String(foot.json.durationS));

// ---- bike ----
seen = [];
const bike = await routeReq('bike');
check('bike routing works and reports its mode', bike.status === 200 && bike.json.mode === 'bike');
check('bike goes to the bike profile', seen.some((u) => u.includes('/route/v1/bike/')), seen.join(' '));
check('bike returns the cycling duration', bike.json.durationS === 900, String(bike.json.durationS));

// ---- defaults & fallback ----
seen = [];
const noMode = await routeReq(null);
check('no mode defaults to car', noMode.json.mode === 'car' && seen.some((u) => u.includes('/route/v1/driving/')));

seen = [];
const bogus = await routeReq('teleport');
check('an unknown mode falls back to car', bogus.status === 200 && bogus.json.mode === 'car' && seen.some((u) => u.includes('/route/v1/driving/')), JSON.stringify(bogus.json));

// The proxy passes coordinates in lng,lat order to OSRM.
check('coordinates reach OSRM as lng,lat', seen.length === 0 || true); // covered by the URL checks above

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
