// L40 smoke test: worldwide routing fallback.
//
// The self-hosted OSRM graphs cover one region, and OSRM does not refuse a
// request from outside it - it snaps both points to the nearest edge it
// knows, however far away, and routes between the snaps. So the proxy must
// treat three answers from the regional server as "the graph does not cover
// you" and fail over to the worldwide fallback:
//   - an error / non-Ok response,
//   - a response whose waypoints snapped implausibly far,
//   - an unreachable server.
// And it must NOT fail over when the regional answer is good.
// Usage: node tests/smoke33.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4163;
const LOCAL_PORT = 4164; // the "regional" OSRM stub
const FALLBACK_PORT = 4165; // the "worldwide" OSRM stub
const DEAD_PORT = 4166; // nothing listens here
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data33');

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

const okBody = (duration, snapM) =>
  JSON.stringify({
    code: 'Ok',
    routes: [{ distance: 3000, duration, geometry: { coordinates: [[76.89, 43.24], [76.9, 43.25]] } }],
    waypoints: [{ distance: snapM }, { distance: snapM }],
  });

// The regional stub scripts its behaviour off the FROM latitude:
//   43.x  -> a good in-region answer (waypoints snapped 3 m away)
//   52.x  -> "Leicester": Ok, but both points snapped 300 km away
//   10.x  -> a NoRoute error body
//   (unreachable is exercised separately via DEAD_PORT)
let localCalls = 0;
const localStub = http.createServer((req, res) => {
  localCalls++;
  const lat = (req.url.match(/\/route\/v1\/[a-z]+\/[^,]+,([0-9.]+);/) || [])[1] || '';
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (lat.startsWith('52')) res.end(okBody(600, 300000));
  else if (lat.startsWith('10')) res.end(JSON.stringify({ code: 'NoRoute', routes: [] }));
  else res.end(okBody(600, 3));
});

let fallbackCalls = 0;
const fallbackStub = http.createServer((req, res) => {
  fallbackCalls++;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(okBody(999, 4));
});

await new Promise((r) => localStub.listen(LOCAL_PORT, r));
await new Promise((r) => fallbackStub.listen(FALLBACK_PORT, r));

fs.rmSync(DATA_DIR, { recursive: true, force: true });
const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR,
    OSRM_URL: `http://localhost:${LOCAL_PORT}`,
    OSRM_FOOT_URL: `http://localhost:${LOCAL_PORT}`,
    // bike deliberately points at a dead port: the unreachable-server case.
    OSRM_BIKE_URL: `http://localhost:${DEAD_PORT}`,
    OSRM_FALLBACK_URL: `http://localhost:${FALLBACK_PORT}`,
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
    localStub.close();
    fallbackStub.close();
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

const reg = await api('POST', '/api/register', { phone: '+77015568100', password: 'almaty2026', name: 'Aigerim' });
const user = (await api('POST', '/api/verify', { phone: '+77015568100', code: reg.json.devCode })).json;
const routeUrl = (fromLat, fromLng, toLat, toLng, mode = 'car') =>
  `/api/geo/route?fromLat=${fromLat}&fromLng=${fromLng}&toLat=${toLat}&toLng=${toLng}&mode=${mode}`;

// ---- in-region: the regional server answers and the fallback is not asked ----
{
  const before = fallbackCalls;
  const r = await api('GET', routeUrl(43.24, 76.89, 43.25, 76.9), null, user.token);
  check('an in-region route is served by the regional server', r.status === 200 && r.json.durationS === 600, JSON.stringify(r.json));
  check('...without touching the fallback', fallbackCalls === before);
}

// ---- outside the region: Ok-but-far-snapped fails over ----
{
  const r = await api('GET', routeUrl(52.63, -1.13, 52.64, -1.12), null, user.token);
  check(
    'a far-snapped answer (Leicester through Kazakhstan) fails over to the fallback',
    r.status === 200 && r.json.durationS === 999,
    JSON.stringify(r.json)
  );
}

// ---- upstream error body fails over ----
{
  const r = await api('GET', routeUrl(10.1, 10.1, 10.2, 10.2), null, user.token);
  check('a NoRoute answer fails over to the fallback', r.status === 200 && r.json.durationS === 999, JSON.stringify(r.json));
}

// ---- unreachable regional server fails over ----
{
  const r = await api('GET', routeUrl(43.24, 76.89, 43.26, 76.91, 'bike'), null, user.token);
  check('an unreachable regional server fails over to the fallback', r.status === 200 && r.json.durationS === 999, JSON.stringify(r.json));
  check('...reporting the requested mode', r.json.mode === 'bike');
}

// ---- the good path really was local: the regional stub was consulted ----
check('the regional server was consulted for the earlier requests', localCalls >= 3, String(localCalls));

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
