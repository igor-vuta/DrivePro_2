// L55 smoke test: which basemap engine draws where.
//
// MapGL does not refuse a request outside the countries 2GIS maps - it hands
// back an empty world, which on a phone is indistinguishable from a broken
// app. This is the same lesson routing learned from Leicester, where a
// regional graph confidently answered a question about a place it had never
// heard of: do not trust a provider outside the ground it covers.
//
// No server here - mapconfig.js is plain JavaScript with no react-native in
// it, so the decision can be tested directly.
//
// Pinned here:
//   - cities 2GIS maps get the vector engine
//   - cities it does not get OpenStreetMap raster, which covers everywhere
//   - an unknown position is not treated as uncovered, or the map would flip
//     to raster for a moment on every cold start
//   - a missing key, and dark with no dark style, still win over coverage
// Usage: node tests/smoke40.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { covers2gis, setMapKey, setMapStyles, getMapStyle } = await import(
  path.join(__dirname, '..', '..', 'app', 'src', 'mapconfig.js')
);

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

// ---- where 2GIS has a map ----
{
  const covered = [
    ['Almaty', 43.2389, 76.8897],
    ['Astana', 51.1605, 71.4704],
    ['Moscow', 55.7558, 37.6173],
    ['Novosibirsk', 55.0084, 82.9357],
    ['Bishkek', 42.8746, 74.5698],
    ['Tashkent', 41.2995, 69.2401],
    ['Baku', 40.4093, 49.8671],
    ['Dubai', 25.2048, 55.2708],
    ['Prague', 50.0755, 14.4378],
  ];
  for (const [name, lat, lng] of covered) {
    check(`${name} gets the 2GIS map`, covers2gis(lat, lng) === true);
  }
}

// ---- where it does not, and OpenStreetMap has to carry it ----
{
  const uncovered = [
    ['Leicester', 52.6369, -1.1398], // the city that exposed the routing version of this
    ['London', 51.5074, -0.1278],
    ['Berlin', 52.52, 13.405],
    ['Paris', 48.8566, 2.3522],
    ['New York', 40.7128, -74.006],
    ['Tokyo', 35.6762, 139.6503],
    ['Nairobi', -1.2921, 36.8219],
    ['Sydney', -33.8688, 151.2093],
  ];
  for (const [name, lat, lng] of uncovered) {
    check(`${name} falls back to OpenStreetMap`, covers2gis(lat, lng) === false);
  }
}

// ---- an unknown position is not "uncovered" ----
{
  check('no position yet is treated as covered', covers2gis(undefined, undefined) === true);
  check('...and so is a nonsense one', covers2gis(NaN, NaN) === true);
}

// ---- the style ids still answer per scheme ----
{
  setMapStyles({ light: 'light-id', dark: null });
  check('a configured light style is returned', getMapStyle('light') === 'light-id');
  check('an unconfigured dark style is null, not undefined', getMapStyle('dark') === null);
  setMapKey('');
  check('an empty key is null, not an empty string', (await import(path.join(__dirname, '..', '..', 'app', 'src', 'mapconfig.js'))).getMapKey() === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
