// L61 smoke test: the new foundations - navy/blue/apple palette, the type
// ramp, and Manrope as the app font.
//
// smoke38 already pins the elevation ladder and AA for the regions and inks it
// knew about. This layer adds a region those rules deliberately do not cover -
// the navy brand surface, which is dark in BOTH schemes and so sits outside
// the light/dark ladder - plus a commit colour and a typographic scale. Each
// needs its own contract or nothing checks it.
//
// Like smoke38 this reads app/src/theme.js as text: importing it would pull in
// react-native.
// Usage: node tests/smoke61.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(__dirname, '..', '..', 'app');
const THEME = path.join(APP, 'src', 'theme.js');
const FONT_DIR = path.join(APP, 'public', 'fonts');

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

// ---------------------------------------------------------------- palette ---

const BRAND_TOKENS = ['brand', 'onBrand', 'brandSub', 'brandOk', 'go', 'onGo', 'signal'];

for (const [name, sc] of [['light', light], ['dark', dark]]) {
  for (const k of BRAND_TOKENS) {
    check(`${name}.${k} is a hex colour`, /^#[0-9A-Fa-f]{6}$/.test(sc[k] || ''), String(sc[k]));
  }

  // The brand surface is its own region. smoke38's ink sweep never touches it
  // (it is not in AREAS), so the three inks that DO land on it are pinned here.
  for (const ink of ['onBrand', 'brandSub', 'brandOk']) {
    const c = contrast(sc[ink], sc.brand);
    check(`${name}: ${ink} on brand clears AA`, c >= 4.5, `${c.toFixed(2)}:1`);
  }

  // The commit button: a fill under button-sized bold type, so AA-large.
  const cta = contrast(sc.onGo, sc.go);
  check(`${name}: onGo on go clears AA-large`, cta >= 3, `${cta.toFixed(2)}:1`);

  // The brand surface is dark in both schemes - that is what makes it the
  // brand rather than a step on the ladder. If it ever drifts light in the
  // light scheme, onBrand (white) silently becomes unreadable.
  check(`${name}: brand is a dark surface`, lum(sc.brand) < 0.1, `lum=${lum(sc.brand).toFixed(3)}`);

  // `signal` exists to be found on a busy map, so it must be brighter than
  // the fill it is the twin of.
  check(`${name}: signal is brighter than go`, lum(sc.signal) > lum(sc.go));
}

// Apple is the commit colour and blue is the interactive one; if they ever
// collapse to the same value the design loses the distinction it is built on.
check('go and primary are different colours', light.go !== light.primary && dark.go !== dark.primary);

// ------------------------------------------------------------------- type ---

const STEPS = ['display', 'title', 'row', 'body', 'sub', 'meta', 'overline', 'button', 'chip'];
const typeBlock = src.split('export const TYPE = {')[1]?.split('\n};')[0] ?? '';
const steps = {};
for (const m of typeBlock.matchAll(/^ {2}(\w+): \{ fontFamily: FONT, fontSize: ([\d.]+), fontWeight: '(\d+)'/gm)) {
  steps[m[1]] = { size: Number(m[2]), weight: Number(m[3]) };
}

check('TYPE declares every step', STEPS.every((k) => k in steps), `missing=${STEPS.filter((k) => !(k in steps))}`);
for (const k of STEPS) {
  check(`TYPE.${k} names the app font`, new RegExp(`^ {2}${k}: \\{ fontFamily: FONT,`, 'm').test(typeBlock));
}

// A ramp is only a ramp if the steps are ordered. These are the three that
// carry the hierarchy of a screen.
check(
  'display > title > row',
  steps.display?.size > steps.title?.size && steps.title?.size > steps.row?.size,
  `${steps.display?.size} ${steps.title?.size} ${steps.row?.size}`
);
check('meta is the smallest body-ish step', steps.meta?.size < steps.sub?.size && steps.sub?.size < steps.body?.size);
check('the headline steps are the heaviest', steps.display?.weight >= 800 && steps.title?.weight >= 800);
check('overline is uppercase', /overline: \{[^}]*textTransform: 'uppercase'/.test(typeBlock));

// ------------------------------------------------------------------- font ---

check("FONT names Manrope first", /export const FONT = webFont\s*\n\s*\? 'Manrope,/.test(src), 'web stack');
check('FONT falls back to a single family on native', /: 'Manrope';/.test(src));

// The subsets. cyrillic-ext is the one that is easy to drop and expensive to
// lose: the Kazakh letters (Ә Қ Ң Ө Ү Һ) live there and nowhere else, so
// without it they fall back mid-word in the middle of Kazakh UI.
const SUBSETS = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'];
for (const s of SUBSETS) {
  const f = path.join(FONT_DIR, `manrope-${s}.woff2`);
  const ok = fs.existsSync(f) && fs.statSync(f).size > 1024;
  check(`manrope-${s}.woff2 is shipped`, ok, ok ? '' : 'missing or empty');
}

const fontCss = fs.existsSync(path.join(FONT_DIR, 'manrope.css'))
  ? fs.readFileSync(path.join(FONT_DIR, 'manrope.css'), 'utf8')
  : '';
check('manrope.css declares every subset', SUBSETS.every((s) => fontCss.includes(`manrope-${s}.woff2`)));
check(
  'manrope.css covers the Kazakh block',
  /unicode-range:[^;]*U\+0460-052F/.test(fontCss),
  'cyrillic-ext range absent'
);
check('manrope.css keeps url()s relative', !/url\("\//.test(fontCss), 'absolute url would break the design-sync copy');
check('@font-face weights span the ramp', /font-weight: 500 800;/.test(fontCss));

// postexport is what puts the family on the page; without it every @font-face
// above is dead weight and the app renders in the system stack.
const post = fs.readFileSync(path.join(APP, 'tools', 'postexport.mjs'), 'utf8');
check('postexport inlines the font css', post.includes('manrope.css') && post.includes('fontCss'));
check('postexport rewrites the font urls to /fonts/', post.includes("'url(\"/fonts/manrope-'") || post.includes('url("/fonts/manrope-'));
check('postexport paints the new ground', post.includes('#EEF2F7') && post.includes('#0A1420'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
