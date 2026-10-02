// L58 smoke test: the raster basemap's identity.
//
// The bug this pins was invisible to every other kind of test. CARTO began
// watermarking keyless basemap requests with "API KEY REQUIRED" stamped across
// the tile, and served it as HTTP 200 - nothing threw, nothing logged, no
// error handler fired. The map simply rendered defaced. So the test is the
// tile URL itself, read as text, in both places that draw a Leaflet map: the
// app, and the public share page a rider sends to friends.
//
// Pinned here:
//   - no request to a keyed tile host anywhere in the source
//   - OpenStreetMap's own host, without {s} (the a/b/c subdomains are retired)
//     and without {r} (standard OSM serves no @2x tiles; asking 404s)
//   - the attribution and its copyright link, which the OSM tile usage policy
//     requires and a tidy-up must not quietly drop
//   - a dark map that is dark: OSM publishes no dark raster, so night is the
//     light one inverted, and the filter lands on tiles only - inverting the
//     markers would turn the pickup pin blue and the route orange
//   - the boot line names what is actually served, in every key combination
// Usage: node tests/smoke58.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

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

const mapView = read('app', 'src', 'MapView.js');
const api = read('server', 'src', 'api.js');
const theme = read('app', 'src', 'theme.js');
const readme = read('README.md');

// The two files that build a Leaflet map, and the third that could grow one.
const drawers = [
  ['app/src/MapView.js', mapView],
  ['server/src/api.js', api],
];

// ------------------------------------------------------- the tile source ---

for (const [name, src] of drawers) {
  check(`${name}: no cartocdn`, !src.includes('cartocdn'));
  check(
    `${name}: OpenStreetMap tiles`,
    src.includes("L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png'")
  );
}

// A tile template is one line; the mistakes are inside it.
for (const [name, src] of drawers) {
  for (const m of src.matchAll(/L\.tileLayer\('([^']+)'/g)) {
    const url = m[1];
    check(`${name}: no {s} in ${url}`, !url.includes('{s}'));
    check(`${name}: no {r} in ${url}`, !url.includes('{r}'));
    check(`${name}: tiles over https in ${url}`, url.startsWith('https://'));
  }
}

// ------------------------------------------------------- the attribution ---

for (const [name, src] of drawers) {
  const block = src.slice(src.indexOf('tile.openstreetmap.org'));
  const attr = block.slice(0, block.indexOf('addTo(map)'));
  check(`${name}: credits OpenStreetMap contributors`, /OpenStreetMap<\/a> contributors/.test(attr));
  check(
    `${name}: links the copyright page`,
    attr.includes('https://www.openstreetmap.org/copyright')
  );
}
// Leaflet hides the control if it is asked to; neither map may.
check('app: attribution control on', mapView.includes('attributionControl: true'));
check('share page: attribution control not disabled', !api.includes('attributionControl: false'));

// -------------------------------------------------------------- the dark ---

const scheme = (name) => {
  const body = theme.split(`const ${name} = {`)[1].split('\n};')[0];
  const out = {};
  for (const m of body.matchAll(/^ {2}(\w+): (?:'([^']*)'|PALETTE\.(\w+)),$/gm)) out[m[1]] = m[2] ?? m[3];
  return out;
};
const light = scheme('light');
const dark = scheme('dark');

check('light declares mapFilter', typeof light.mapFilter === 'string');
check('dark declares mapFilter', typeof dark.mapFilter === 'string');
check('light leaves OSM untouched', light.mapFilter === 'none', light.mapFilter);
check('dark inverts the tiles', /invert\(1\)/.test(dark.mapFilter || ''), dark.mapFilter);
check(
  'dark rotates the hue back',
  /hue-rotate\(180deg\)/.test(dark.mapFilter || ''),
  dark.mapFilter
);
check('mapTiles is gone', !('mapTiles' in light) && !('mapTiles' in dark));

// The filter must be scoped to the tiles. `.leaflet-container` or `#map` would
// invert the pins and the route with them.
for (const [name, src] of drawers) {
  const rules = [...src.matchAll(/([^\n{};]*)\{\s*filter:\s*([^}]*)\}/g)].filter((m) =>
    /invert|mapFilter/.test(m[2])
  );
  check(`${name}: has a tile filter rule`, rules.length === 1, `found ${rules.length}`);
  for (const r of rules) {
    check(`${name}: filter scoped to .leaflet-tile`, r[1].trim() === '.leaflet-tile', r[1].trim());
  }
}
// The share page is dark whatever the viewer's system says, so its filter is
// unconditional; the app's comes from the scheme.
check('app: tile filter comes from the theme', mapView.includes('filter: ${colors.mapFilter}'));
check('share page: tile filter is inverted', api.includes('.leaflet-tile{filter:invert(1)'));

// --------------------------------------------------------- the boot line ---

// The keys are read at module load, and the suite runs without any set - so
// the live call pins the keyless line and the source pins the other three.
const { describeMapKey } = await import('../src/places.js');
const places = read('server', 'src', 'places.js');
check('boot line no longer claims OSM while serving CARTO', !places.includes('CARTO'));
check(
  'keyless boot line says OpenStreetMap everywhere',
  describeMapKey().includes('OpenStreetMap raster everywhere')
);
check(
  'boot line warns about a missing dark style',
  places.includes('TWOGIS_MAP_STYLE_DARK') && /night map stays raster/.test(places)
);
check(
  'boot line names both basemaps when a key is set',
  /2GIS MapGL where 2GIS has coverage[\s\S]{0,200}OpenStreetMap raster elsewhere/.test(places)
);
check(
  'boot line still warns about reusing the catalog key',
  places.includes('set TWOGIS_MAP_KEY to a domain-restricted key')
);

// ------------------------------------------------------------ documented ---

for (const v of ['TWOGIS_MAP_KEY', 'TWOGIS_MAP_STYLE_DARK', 'TWOGIS_MAP_STYLE', 'TWOGIS_KEY']) {
  check(`README documents ${v}`, readme.includes(v));
}

// ------------------------------------------------------- the shipped app ---
//
// app/dist is committed and is what the server actually serves. A source fix
// without a rebuild leaves the running app still defaced, which is the exact
// failure this layer exists to end.
const dist = path.join(ROOT, 'app', 'dist', '_expo', 'static', 'js', 'web');
const bundles = fs.existsSync(dist) ? fs.readdirSync(dist).filter((f) => f.endsWith('.js')) : [];
check('exactly one web bundle', bundles.length === 1, bundles.join(' '));
if (bundles.length === 1) {
  const built = fs.readFileSync(path.join(dist, bundles[0]), 'utf8');
  check('bundle: no cartocdn', !built.includes('cartocdn'));
  check('bundle: OpenStreetMap tiles', built.includes('tile.openstreetmap.org'));
  check('bundle: dark filter', built.includes('invert(1) hue-rotate(180deg)'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
