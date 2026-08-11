// L46 smoke test: the places proxy.
//
// The provider key must never leave the server, provider quirks must be
// absorbed here rather than in the app, and the normalised shape must stay
// provider-neutral so a second source can be added later.
//
// Pinned here:
//   - the key is never echoed to a client
//   - search / near / byid all normalise to one shape
//   - 2GIS reports "nothing found" as meta.code 404 - that is an empty list,
//     not an error
//   - a provider error becomes a clean 502, not a leaked upstream message
//   - opening hours and phones are parsed; unparseable ones become null
//   - with no key configured the endpoints say so and /api/me admits it
// Usage: node tests/smoke36.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4170;
const CAT_PORT = 4171;
const OFF_PORT = 4172; // a second server with no key configured
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data36');
const DATA_DIR_OFF = path.join(__dirname, '.tmp-data36b');
const KEY = 'secret-key-do-not-leak';

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

// ---- stub catalog, standing in for 2GIS ----
const seenUrls = [];
const catalog = http.createServer((req, res) => {
  seenUrls.push(req.url);
  const u = new URL(req.url, 'http://x');
  res.setHeader('Content-Type', 'application/json');
  // The live API rejects these, so the stub does too - both were shipped
  // wrong once because the documentation disagrees with the service.
  // byid carries no page_size, so only check it when one is sent.
  const ps = Number(u.searchParams.get('page_size') || '0');
  if (u.searchParams.has('page_size') && (ps < 1 || ps > 10)) {
    res.end(JSON.stringify({ meta: { code: 400, error: { message: "Length of parameter 'page_size' should be from 1 to 10" } } }));
    return;
  }
  const loc = u.searchParams.get('locale') || '';
  if (!['ru_KZ', 'kk_KZ'].includes(loc)) {
    res.end(JSON.stringify({ meta: { code: 400, error: { message: `Param 'locale' is invalid. Value '${loc}' is outside of allowed values` } } }));
    return;
  }
  if (u.pathname.endsWith('/byid')) {
    res.end(
      JSON.stringify({
        meta: { code: 200 },
        result: {
          items: [
            {
              id: u.searchParams.get('id'),
              name: 'Dostyk Plaza',
              address_name: 'Самал-2, 111',
              full_address_name: 'Алматы, Самал-2, 111',
              point: { lat: 43.2331, lon: 76.9555 },
              rubrics: [{ name: 'Торговые центры' }],
            },
          ],
        },
      })
    );
    return;
  }
  const q = u.searchParams.get('q') || '';
  // Point lookup: no q, restricted to businesses. The real API answers a
  // wildcard q with 404 and an unfiltered point query with districts, so the
  // proxy must send exactly this shape.
  if (!q && u.searchParams.get('type') === 'branch') {
    res.end(
      JSON.stringify({
        meta: { code: 200 },
        result: {
          items: [
            {
              id: '80000001',
              name: 'НИИ кардиологии',
              address_name: 'улица Айтеке би, 120',
              point: { lat: 43.2567, lon: 76.9286 },
              rubrics: [{ name: 'Больницы' }],
            },
          ],
        },
      })
    );
    return;
  }
  if (q === 'nothingatall') {
    // 2GIS answers "no matches" with meta.code 404 and an error block.
    res.end(JSON.stringify({ meta: { code: 404, error: { message: 'Results not found' } } }));
    return;
  }
  if (q === 'boom') {
    res.end(JSON.stringify({ meta: { code: 403, error: { message: 'Key quota exceeded for project 12345' } } }));
    return;
  }
  res.end(
    JSON.stringify({
      meta: { code: 200 },
      result: {
        total: 2,
        items: [
          {
            id: '70000001',
            name: 'Биосфера, аптека',
            address_name: 'улица Ауэзова, 104Б',
            full_address_name: 'Алматы, улица Ауэзова, 104Б',
            point: { lat: 43.234661, lon: 76.904896 },
            rubrics: [{ name: 'Аптеки' }, { name: 'Оптика' }],
            schedule: {
              Mon: { working_hours: [{ from: '09:00', to: '21:00' }] },
              Sun: { working_hours: [{ from: '10:00', to: '18:00' }] },
            },
            contact_groups: [{ contacts: [{ type: 'phone', value: '+7 727 000 0000' }, { type: 'email', value: 'x@y.z' }] }],
          },
          {
            id: '70000002',
            name: 'No coordinates here',
            address_name: 'nowhere',
            // No point at all: must be dropped rather than rendered at 0,0.
          },
        ],
      },
    })
  );
});
await new Promise((r) => catalog.listen(CAT_PORT, r));

const spawnServer = (port, dir, env) => {
  fs.rmSync(dir, { recursive: true, force: true });
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, TWOGIS_API_URL: `http://localhost:${CAT_PORT}`, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 8000);
    p.stdout.on('data', (d) => {
      if (String(d).includes('running')) {
        clearTimeout(t);
        resolve(p);
      }
    });
  });
};

const server = await spawnServer(PORT, DATA_DIR, { TWOGIS_KEY: KEY });
const serverOff = await spawnServer(OFF_PORT, DATA_DIR_OFF, { TWOGIS_KEY: '' });

const cleanup = () => {
  try {
    server.kill();
    serverOff.kill();
    catalog.close();
  } catch {}
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.rmSync(DATA_DIR_OFF, { recursive: true, force: true });
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
const user = await reg(BASE, '+77015570001', 'Aisha');

// ---- auth is required ----
{
  const anon = await api(BASE, 'GET', '/api/places/search?q=аптека');
  check('places require a signed-in user', anon.status === 401, String(anon.status));
}

// ---- text search normalises, and drops entries without coordinates ----
let first = null;
{
  const r = await api(BASE, 'GET', '/api/places/search?q=аптека&lat=43.2389&lng=76.8897&lang=ru', null, user.token);
  const list = (r.json && r.json.results) || [];
  first = list[0];
  check('search returns places', r.status === 200 && list.length === 1, JSON.stringify(list).slice(0, 160));
  check('...normalised to our own shape', first && first.id === '70000001' && first.name === 'Биосфера, аптека' && first.lat === 43.234661 && first.lng === 76.904896, JSON.stringify(first));
  check('...with categories', first && first.categories.length === 2 && first.categories[0] === 'Аптеки');
  check('...opening hours parsed per day', first && first.schedule && first.schedule.mon[0].from === '09:00' && first.schedule.sun[0].to === '18:00', JSON.stringify(first && first.schedule));
  check('...phones extracted, emails not', first && first.phones.length === 1 && first.phones[0].startsWith('+7'), JSON.stringify(first && first.phones));
  check('an item with no coordinates is dropped, not placed at 0,0', list.every((x) => x.lat !== 0));
}

// ---- the key never reaches the client, in any response ----
{
  const r = await api(BASE, 'GET', '/api/places/search?q=аптека&lang=ru', null, user.token);
  check('the provider key is not echoed to the client', !r.text.includes(KEY));
  check('...and the upstream did receive it', seenUrls.some((u) => u.includes(encodeURIComponent(KEY)) || u.includes(KEY)));
}

// ---- category search near a point ----
{
  const r = await api(BASE, 'GET', '/api/places/near?q=аптека&lat=43.2389&lng=76.8897&radius=1200&lang=ru', null, user.token);
  check('near returns places', r.status === 200 && r.json.results.length === 1);
  const asked = seenUrls[seenUrls.length - 1];
  check('...asking the provider by point and radius', asked.includes('point=76.8897,43.2389') && asked.includes('radius=1200'), asked);
  const huge = await api(BASE, 'GET', '/api/places/near?q=аптека&lat=43.2389&lng=76.8897&radius=999999&lang=ru', null, user.token);
  check('an absurd radius is clamped, not forwarded', huge.status === 200 && seenUrls[seenUrls.length - 1].includes('radius=5000'));
}

// ---- tapping the map: what is at this point ----
{
  const r = await api(BASE, 'GET', '/api/places/at?lat=43.2567&lng=76.9286&radius=80&lang=ru', null, user.token);
  check('a map tap resolves to the business there', r.status === 200 && r.json.results[0] && r.json.results[0].name === 'НИИ кардиологии', JSON.stringify(r.json).slice(0, 140));
  const asked = seenUrls[seenUrls.length - 1];
  check('...asked as a tight branch-only radius, with no wildcard query', asked.includes('type=branch') && asked.includes('radius=80') && !asked.includes('q='), asked);
  const wide = await api(BASE, 'GET', '/api/places/at?lat=43.2567&lng=76.9286&radius=99999&lang=ru', null, user.token);
  check('a tap radius cannot be widened into an area search', wide.status === 200 && seenUrls[seenUrls.length - 1].includes('radius=300'));
}

// ---- details by id ----
{
  const r = await api(BASE, 'GET', '/api/places/70000001?lang=ru', null, user.token);
  check('byid returns one place', r.status === 200 && r.json.place && r.json.place.name === 'Dostyk Plaza', JSON.stringify(r.json).slice(0, 140));
}

// ---- "nothing found" is an empty list, not an error ----
{
  const r = await api(BASE, 'GET', '/api/places/search?q=nothingatall&lang=ru', null, user.token);
  check('no matches is an empty list, not a failure', r.status === 200 && r.json.results.length === 0, String(r.status));
}

// ---- a provider failure is a clean 502 with nothing leaked ----
{
  const r = await api(BASE, 'GET', '/api/places/search?q=boom&lang=ru', null, user.token);
  check('a provider error surfaces as 502', r.status === 502, String(r.status));
  check('...without leaking the key', !r.text.includes(KEY));
}

// ---- with no key configured, the app is told rather than left guessing ----
{
  const off = await reg(`http://localhost:${OFF_PORT}`, '+77015570002', 'Timur');
  const me = await api(`http://localhost:${OFF_PORT}`, 'GET', '/api/me', null, off.token);
  check('/api/me reports places off when unconfigured', me.json.placesProvider === false, JSON.stringify(me.json.placesProvider));
  const r = await api(`http://localhost:${OFF_PORT}`, 'GET', '/api/places/search?q=аптека', null, off.token);
  check('...and the endpoint says so plainly', r.status === 503 && r.json.code === 'places_off', JSON.stringify(r.json));
  const meOn = await api(BASE, 'GET', '/api/me', null, user.token);
  check('/api/me reports places on when configured', meOn.json.placesProvider === true);
}

// ---- the live API's real limits, learned the hard way ----
//
// The docs say page_size may be 50 and imply en_US is fine; the service caps
// page_size at 10 and rejects any locale outside its region list. Both
// reached a phone before being caught, so both are pinned here.
{
  for (const [what, path] of [
    ['search', '/api/places/search?q=аптека&lang=ru'],
    ['near', '/api/places/near?q=аптека&lat=43.2389&lng=76.8897&lang=ru'],
    ['at', '/api/places/at?lat=43.2567&lng=76.9286&lang=ru'],
  ]) {
    const r = await api(BASE, 'GET', path, null, user.token);
    const asked = seenUrls[seenUrls.length - 1];
    const ps = Number(new URL(asked, 'http://x').searchParams.get('page_size'));
    check(`${what} asks for at most 10 results`, r.status === 200 && ps >= 1 && ps <= 10, `${ps} in ${asked}`);
  }
  for (const [lang, want] of [['ru', 'ru_KZ'], ['kk', 'kk_KZ'], ['en', 'ru_KZ']]) {
    const r = await api(BASE, 'GET', `/api/places/search?q=аптека&lang=${lang}`, null, user.token);
    const asked = seenUrls[seenUrls.length - 1];
    check(`lang=${lang} uses a locale the service accepts (${want})`, r.status === 200 && asked.includes(`locale=${want}`), asked);
  }
}

// ---- provider wording never reaches a person ----
{
  const r = await api(BASE, 'GET', '/api/places/search?q=boom&lang=ru', null, user.token);
  check('a provider complaint is not shown to the user verbatim', r.status === 502 && !/page_size|quota|project/i.test(r.text), r.text.slice(0, 120));
  check('...a readable sentence is sent instead', r.json && r.json.code === 'places_upstream', JSON.stringify(r.json));
}

// ---- the cache is blunt on purpose: the quota is 1,000 calls a month ----
//
// Two people on the same street asking the same question must cost one call,
// not two, and the answer has to survive the restart that every deploy causes.
{
  const before = seenUrls.length;
  await api(BASE, 'GET', '/api/places/near?q=кофе&lat=43.23891&lng=76.88971&radius=1200&lang=ru', null, user.token);
  const first = seenUrls.length - before;
  check('an uncached question does reach the provider', first === 1, `${first} calls`);
  // Same block, a different doorway, and a radius nobody would call different.
  await api(BASE, 'GET', '/api/places/near?q=кофе&lat=43.23955&lng=76.88840&radius=1250&lang=ru', null, user.token);
  check('a neighbour asking the same thing costs nothing', seenUrls.length - before === first, `${seenUrls.length - before} calls`);

  // A tap on a building must stay on that building - that key is not coarsened.
  // Fresh coordinates, because an earlier case in this file already cached its.
  const b4 = seenUrls.length;
  await api(BASE, 'GET', '/api/places/at?lat=43.2601&lng=76.9401&lang=ru', null, user.token);
  await api(BASE, 'GET', '/api/places/at?lat=43.2623&lng=76.9433&lang=ru', null, user.token);
  check('a tap on a different building is a different question', seenUrls.length - b4 === 2, `${seenUrls.length - b4} calls`);
}

// ---- the cache outlives a restart ----
//
// This app redeploys on every push, so a cache that empties on restart is a
// cache that never warms up. Note the local spawn helper: the shared one wipes
// the data directory, which is exactly what must survive here.
{
  const dir = path.join(__dirname, '.tmp-data36c');
  fs.rmSync(dir, { recursive: true, force: true });
  const port = 4173;
  const keepSpawn = () =>
    new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
        env: { ...process.env, PORT: String(port), DATA_DIR: dir, TWOGIS_API_URL: `http://localhost:${CAT_PORT}`, TWOGIS_KEY: KEY },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const t = setTimeout(() => reject(new Error('cache server did not start')), 15000);
      let out = '';
      proc.stdout.on('data', (d) => {
        out += String(d);
        if (out.includes('running')) {
          clearTimeout(t);
          resolve(proc);
        }
      });
    });

  const base = `http://localhost:${port}`;
  const s1 = await keepSpawn();
  const u = await reg(base, '+77015570003', 'Alua');
  const b4 = seenUrls.length;
  await api(base, 'GET', '/api/places/search?q=аптека&lang=ru', null, u.token);
  check('a cold cache asks the provider', seenUrls.length === b4 + 1, `${seenUrls.length - b4} calls`);

  // The cache is written on a 10s debounce; wait it out before pulling the plug.
  await new Promise((r) => setTimeout(r, 11000));
  await new Promise((r) => {
    s1.once('exit', r);
    s1.kill();
  });

  const s2 = await keepSpawn();
  const after = seenUrls.length;
  const again = await api(base, 'GET', '/api/places/search?q=аптека&lang=ru', null, u.token);
  check('the same question after a restart costs nothing', seenUrls.length === after, `${seenUrls.length - after} calls`);
  check('...and still answers with the same place', again.status === 200 && again.json.results[0] && again.json.results[0].name === 'Биосфера, аптека', JSON.stringify(again.json).slice(0, 140));
  s2.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
