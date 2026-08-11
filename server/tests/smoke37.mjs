// L51 smoke test: the basemap key, and the line between the two 2GIS keys.
//
// Every other credential in this app is a server secret. The MapGL key is not
// and cannot be: the basemap is drawn by WebGL in the browser and authenticates
// itself from there. So this pins the one thing that still matters - which key
// goes out, to whom, and that the catalog key does not leave by accident.
//
// Pinned here:
//   - no key configured: /api/me says mapKey is null and the app draws OSM
//   - TWOGIS_MAP_KEY set: that key goes out, and the catalog key never does
//   - only TWOGIS_KEY set: it is reused, because one-key deployments should
//     still get a map - but boot says so out loud
//   - the map key is never handed to an anonymous caller
// Usage: node tests/smoke37.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT_NONE = 4180;
const PORT_BOTH = 4181;
const PORT_ONE = 4182;
const CATALOG_KEY = 'catalog-key-server-only';
const MAP_KEY = 'mapgl-key-meant-for-browsers';

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

const dirs = [];
const procs = [];

// Boot output is part of what is being tested here, so it is collected.
const spawnServer = (port, env) => {
  const dir = path.join(__dirname, `.tmp-data37-${port}`);
  fs.rmSync(dir, { recursive: true, force: true });
  dirs.push(dir);
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, NODE_ENV: 'test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  procs.push(p);
  let out = '';
  p.stdout.on('data', (d) => {
    out += String(d);
  });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server on ${port} did not start`)), 8000);
    p.stdout.on('data', () => {
      if (out.includes('running')) {
        clearTimeout(t);
        // The banners print after "running", so give them the same tick.
        setTimeout(() => resolve({ proc: p, boot: () => out }), 150);
      }
    });
  });
};

const cleanup = () => {
  for (const p of procs) {
    try {
      p.kill();
    } catch {}
  }
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
};
process.on('exit', cleanup);

async function api(base, method, p, body, token) {
  const res = await fetch(base + p, {
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

const reg = async (base, phone, name) => {
  const r = await api(base, 'POST', '/api/register', { phone, password: 'almaty2026', name });
  return (await api(base, 'POST', '/api/verify', { phone, code: r.json.devCode })).json;
};

const none = await spawnServer(PORT_NONE, { TWOGIS_KEY: '', TWOGIS_MAP_KEY: '' });
const both = await spawnServer(PORT_BOTH, { TWOGIS_KEY: CATALOG_KEY, TWOGIS_MAP_KEY: MAP_KEY });
const one = await spawnServer(PORT_ONE, { TWOGIS_KEY: CATALOG_KEY, TWOGIS_MAP_KEY: '' });

// ---- nothing configured: the app is told, and falls back to OSM ----
{
  const base = `http://localhost:${PORT_NONE}`;
  const u = await reg(base, '+77015580001', 'Aisha');
  const me = await api(base, 'GET', '/api/me', null, u.token);
  check('with no key at all, /api/me reports mapKey null', me.json.mapKey === null, JSON.stringify(me.json.mapKey));
  check('...and boot says which basemap that leaves', none.boot().includes('OpenStreetMap raster'), none.boot().slice(-200));
}

// ---- both keys: only the browser one leaves ----
{
  const base = `http://localhost:${PORT_BOTH}`;
  const u = await reg(base, '+77015580002', 'Timur');
  const me = await api(base, 'GET', '/api/me', null, u.token);
  check('the browser key is handed to a signed-in client', me.json.mapKey === MAP_KEY, JSON.stringify(me.json.mapKey));
  check('the catalog key stays on the server', !me.text.includes(CATALOG_KEY), me.text.slice(0, 200));
  check('...and boot reports a key of its own', both.boot().includes('own browser key'), both.boot().slice(-200));
}

// ---- one key: reused, but never quietly ----
{
  const base = `http://localhost:${PORT_ONE}`;
  const u = await reg(base, '+77015580003', 'Dana');
  const me = await api(base, 'GET', '/api/me', null, u.token);
  check('a single-key deployment still gets a map', me.json.mapKey === CATALOG_KEY, JSON.stringify(me.json.mapKey));
  check('...and boot warns that the catalog key is now public', one.boot().includes('TWOGIS_MAP_KEY'), one.boot().slice(-200));
}

// ---- style ids: no dark style means the app must not go MapGL at night ----
{
  const base = `http://localhost:${PORT_BOTH}`;
  const u = await reg(base, '+77015580004', 'Ruslan');
  const me = await api(base, 'GET', '/api/me', null, u.token);
  check(
    'unconfigured styles are null, not missing',
    me.json.mapStyles && me.json.mapStyles.light === null && me.json.mapStyles.dark === null,
    JSON.stringify(me.json.mapStyles)
  );

  const styled = await spawnServer(4183, {
    TWOGIS_MAP_KEY: MAP_KEY,
    TWOGIS_MAP_STYLE: 'style-light-id',
    TWOGIS_MAP_STYLE_DARK: 'style-dark-id',
  });
  const sBase = 'http://localhost:4183';
  const su = await reg(sBase, '+77015580005', 'Madina');
  const sMe = await api(sBase, 'GET', '/api/me', null, su.token);
  check(
    'configured style ids reach the app, per scheme',
    sMe.json.mapStyles.light === 'style-light-id' && sMe.json.mapStyles.dark === 'style-dark-id',
    JSON.stringify(sMe.json.mapStyles)
  );
  void styled;
}

// ---- the key is not simply public ----
{
  const anon = await api(`http://localhost:${PORT_BOTH}`, 'GET', '/api/me');
  check('an anonymous caller gets no key', anon.status === 401 && !anon.text.includes(MAP_KEY), String(anon.status));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
