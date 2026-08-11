// L54 smoke test: the theme's area ramp, both schemes.
//
// This layer's whole content is a table of colours, so the test is the table's
// contract rather than an HTTP round trip - it needs no server, and it reads
// app/src/theme.js as text because importing it would pull in react-native.
//
// Pinned here:
//   - light and dark declare exactly the same tokens, since applyScheme()
//     copies the keys of whichever scheme is next: a token present in one and
//     missing from the other would keep the previous scheme's value forever
//   - the areas are a strictly ordered elevation ladder in each scheme, and
//     `surface` crosses the ground between them (below in light, above in
//     dark), which is what "inverted where it means something" amounts to
//   - every ink clears WCAG AA (4.5:1) against every area it can land on
//   - the regions are actually distinguishable from each other, so "the navbar
//     has its own colour" survives a future tidy-up
// Usage: node tests/smoke38.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THEME = path.join(__dirname, '..', '..', 'app', 'src', 'theme.js');

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

const src = fs.readFileSync(THEME, 'utf8');

// PALETTE first, so `card: PALETTE.white` resolves like any literal.
const palette = {};
for (const m of src.split('const light = {')[0].matchAll(/^ {2}(\w+): '(#[0-9A-Fa-f]{6})',$/gm)) {
  palette[m[1]] = m[2];
}
const scheme = (name) => {
  const body = src.split(`const ${name} = {`)[1].split('\n};')[0];
  const out = {};
  for (const m of body.matchAll(/^ {2}(\w+): (?:'([^']*)'|PALETTE\.(\w+)),$/gm)) {
    out[m[1]] = m[3] ? palette[m[3]] : m[2];
  }
  return out;
};
const light = scheme('light');
const dark = scheme('dark');

// WCAG relative luminance and contrast, on hex only.
const chan = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => chan(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// The regions a component can paint itself with, and the inks that land on
// them. `tint` is excluded from the ink sweep because only onTint sits on it.
const AREAS = ['bg', 'surface', 'sheet', 'card', 'chrome'];
const INKS = ['text', 'sub', 'primaryInk', 'okInk', 'dangerInk', 'gold'];
const AA = 4.5;

check(
  'light and dark declare the same tokens',
  Object.keys(light).sort().join() === Object.keys(dark).sort().join(),
  `light-only=${Object.keys(light).filter((k) => !(k in dark))} dark-only=${Object.keys(dark).filter((k) => !(k in light))}`
);

for (const [name, sc] of [['light', light], ['dark', dark]]) {
  for (const k of [...AREAS, ...INKS, 'tint', 'onTint', 'border', 'borderStrong', 'primary', 'primaryText']) {
    check(`${name}.${k} is a hex colour`, /^#[0-9A-Fa-f]{6}$/.test(sc[k] || ''), String(sc[k]));
  }

  // Elevation climbs toward light in both schemes: a raised panel catches
  // light whichever way round the ground is.
  const ladder = ['bg', 'sheet', 'card'].map((k) => lum(sc[k]));
  check(
    `${name}: bg < sheet < card`,
    ladder[0] < ladder[1] && ladder[1] < ladder[2],
    ladder.map((v) => v.toFixed(3)).join(' ')
  );

  // ...but the recessed token does not, and that is the inversion.
  const recessed = lum(sc.surface) < lum(sc.bg);
  check(`${name}: surface is ${name === 'light' ? 'below' : 'above'} the ground`, name === 'light' ? recessed : !recessed);

  // Regions have to be told apart, not just named apart.
  for (let i = 0; i < AREAS.length; i++) {
    for (let j = i + 1; j < AREAS.length; j++) {
      const [a, b] = [AREAS[i], AREAS[j]];
      const d = Math.abs(lum(sc[a]) - lum(sc[b]));
      const hueApart = sc[a] !== sc[b] && (a === 'chrome' || b === 'chrome');
      check(`${name}: ${a} differs from ${b}`, d > 0.004 || hueApart, `Δlum=${d.toFixed(4)}`);
    }
  }

  for (const ink of INKS) {
    for (const area of AREAS) {
      const c = contrast(sc[ink], sc[area]);
      check(`${name}: ${ink} on ${area} clears AA`, c >= AA, `${c.toFixed(2)}:1`);
    }
  }
  const onTint = contrast(sc.onTint, sc.tint);
  check(`${name}: onTint on tint clears AA`, onTint >= AA, `${onTint.toFixed(2)}:1`);

  // The brand blue is a fill, and its label is button-sized bold type, so the
  // bar there is AA-large (3:1) rather than 4.5:1.
  const btn = contrast(sc.primaryText, sc.primary);
  check(`${name}: primaryText on primary clears AA-large`, btn >= 3, `${btn.toFixed(2)}:1`);
}

// The tokens are read as `colors.x` all over the app; a component that reaches
// for one that no longer exists renders `undefined` rather than crashing, so
// the spelling is worth pinning from the outside.
const APP_SRC = path.join(__dirname, '..', '..', 'app', 'src');
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
const used = new Set();
for (const file of walk(APP_SRC)) {
  if (file.endsWith(path.join('src', 'theme.js'))) continue;
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/\bcolors\.([a-zA-Z]\w*)/g)) used.add(m[1]);
}
const unknown = [...used].filter((k) => !(k in light));
check('every colors.x the app reads is a declared token', unknown.length === 0, unknown.join(', '));

// Hardcoded colours are scheme-blind by construction - a literal that looked
// right in dark is what made the toast unreadable in light.
const offenders = [];
for (const file of walk(APP_SRC)) {
  if (file.endsWith(path.join('src', 'theme.js')) || file.endsWith(path.join('src', 'i18n.js'))) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(?:backgroundColor|borderColor|borderTopColor|shadowColor|color):\s*'(#[0-9A-Fa-f]{3,8}|rgba?\([^)]*\))'/g)) {
    offenders.push(`${path.basename(file)}: ${m[1]}`);
  }
}
check('no hardcoded colours in style props', offenders.length === 0, offenders.join(' | '));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
