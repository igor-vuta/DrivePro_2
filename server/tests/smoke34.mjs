// L41 smoke test: turn-by-turn steps on the route proxy.
//
// steps=1 must return compact maneuvers ({type, mod, name, distM, loc}) in
// [lat,lng] order; without the flag the field is absent; and the two shapes
// must not share a cache entry.
// Usage: node tests/smoke34.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4167;
const OSRM_PORT = 4168;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data34');

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

// The stub returns steps only when asked - and records whether it was asked.
const asked = [];
const osrm = http.createServer((req, res) => {
  const withSteps = /steps=true/.test(req.url);
  const wantAlts = /alternatives=[1-9]/.test(req.url);
  asked.push(withSteps);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      code: 'Ok',
      waypoints: [{ distance: 3 }, { distance: 4 }],
      routes: [
        {
          distance: 3000,
          duration: 600,
          geometry: { coordinates: [[76.89, 43.24], [76.9, 43.25]] },
          legs: [
            {
              steps: withSteps
                ? [
                    { distance: 120.4, name: 'Abay Avenue', maneuver: { type: 'depart', location: [76.89, 43.24] } },
                    { distance: 500.2, name: 'Seifullin Street', maneuver: { type: 'turn', modifier: 'left', location: [76.895, 43.245] } },
                    { distance: 0, name: '', maneuver: { type: 'arrive', location: [76.9, 43.25] } },
                  ]
                : undefined,
            },
          ],
        },
        ...(wantAlts
          ? [
              {
                distance: 2000,
                duration: 900,
                geometry: { coordinates: [[76.89, 43.24], [76.91, 43.26]] },
                legs: [{ steps: [] }],
              },
            ]
          : []),
      ],
    })
  );
});
await new Promise((r) => osrm.listen(OSRM_PORT, r));

fs.rmSync(DATA_DIR, { recursive: true, force: true });
const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR, OSRM_URL: `http://localhost:${OSRM_PORT}` },
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

const reg = await api('POST', '/api/register', { phone: '+77015568200', password: 'almaty2026', name: 'Dana' });
const user = (await api('POST', '/api/verify', { phone: '+77015568200', code: reg.json.devCode })).json;
const Q = 'fromLat=43.24&fromLng=76.89&toLat=43.25&toLng=76.9';

// ---- without the flag: no steps, upstream asked without steps ----
const plain = await api('GET', `/api/geo/route?${Q}`, null, user.token);
check('a plain route has no steps field', plain.status === 200 && !('steps' in plain.json), JSON.stringify(plain.json).slice(0, 120));
check('...and the upstream was asked without steps', asked[asked.length - 1] === false);

// ---- with the flag: compact steps in [lat,lng] ----
const stepped = await api('GET', `/api/geo/route?${Q}&steps=1`, null, user.token);
const st = (stepped.json && stepped.json.steps) || [];
check('steps=1 returns the maneuvers', stepped.status === 200 && st.length === 3, JSON.stringify(st).slice(0, 200));
check(
  'each step is compact: type/mod/name/distM/loc',
  st[1] &&
    st[1].type === 'turn' &&
    st[1].mod === 'left' &&
    st[1].name === 'Seifullin Street' &&
    st[1].distM === 500 &&
    Array.isArray(st[1].loc),
  JSON.stringify(st[1])
);
check('step locations are [lat,lng], not GeoJSON order', st[0] && st[0].loc[0] === 43.24 && st[0].loc[1] === 76.89, JSON.stringify(st[0]));

// ---- the two shapes do not share a cache entry ----
const plainAgain = await api('GET', `/api/geo/route?${Q}`, null, user.token);
check('a cached plain route still has no steps', !('steps' in plainAgain.json));
const steppedAgain = await api('GET', `/api/geo/route?${Q}&steps=1`, null, user.token);
check('a cached stepped route keeps its steps', (steppedAgain.json.steps || []).length === 3);

// ---- alternatives ----
//
// alts=N asks the upstream for alternatives and returns the extras beside the
// primary; without the flag the field is absent, and the two shapes must not
// share a cache entry (the same trap as steps).
{
  const alt = await api('GET', `/api/geo/route?${Q}&alts=2`, null, user.token);
  check('alts=2 returns the extra routes', (alt.json.alts || []).length === 1, JSON.stringify(alt.json.alts));
  check('...each with its own distance, duration and geometry', alt.json.alts[0].distanceM === 2000 && alt.json.alts[0].durationS === 900 && alt.json.alts[0].points.length === 2, JSON.stringify(alt.json.alts[0]));
  check('...and the primary is still the first route', alt.json.durationS === 600);
  const plainNow = await api('GET', `/api/geo/route?${Q}`, null, user.token);
  check('a route asked without alts has none', !('alts' in plainNow.json));
}

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
