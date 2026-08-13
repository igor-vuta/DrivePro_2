// L63 smoke test: the home screen's floating chrome, rebuilt on the L62
// primitives.
//
// The chrome is three things over a map - the city's live number, your streak,
// your avatar - and each of them used to be hand-rolled here. What this pins
// is that they are made of the design system now, and one contrast pair the
// rest of the suite cannot see: type on the gold fill.
// Usage: node tests/smoke63.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', '..', 'app', 'src');

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

const home = fs.readFileSync(path.join(SRC, 'screens', 'HomeScreen.js'), 'utf8');
const ui = fs.readFileSync(path.join(SRC, 'ui.js'), 'utf8');
const theme = fs.readFileSync(path.join(SRC, 'theme.js'), 'utf8');

// ------------------------------------------------------------- on the gold ---

const palette = {};
for (const m of theme.split('const light = {')[0].matchAll(/^ {2}(\w+): '(#[0-9A-Fa-f]{6})',$/gm)) palette[m[1]] = m[2];
const scheme = (name) => {
  const body = theme.split(`const ${name} = {`)[1].split('\n};')[0];
  const out = {};
  for (const m of body.matchAll(/^ {2}(\w+): (?:'([^']*)'|PALETTE\.(\w+)),$/gm)) out[m[1]] = m[3] ? palette[m[3]] : m[2];
  return out;
};
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

// `gold` is the ink for gold-COLOURED text on a normal region. It is not the
// ink for text ON gold: it measures 4.13:1 there in light, and in dark `gold`
// and `goldFill` are the same value, so the streak pill would have rendered
// gold on gold - invisible. onGold exists for exactly this and nothing else.
for (const name of ['light', 'dark']) {
  const sc = scheme(name);
  check(`${name}.onGold is a hex colour`, /^#[0-9A-Fa-f]{6}$/.test(sc.onGold || ''), String(sc.onGold));
  const c = contrast(sc.onGold, sc.goldFill);
  check(`${name}: onGold on goldFill clears AA`, c >= 4.5, `${c.toFixed(2)}:1`);
}
check(
  'the gold chip inks with onGold, not gold',
  /points: \{ ink: colors\.onGold, fill: colors\.goldFill/.test(ui),
  'gold on gold is invisible in dark'
);

// -------------------------------------------------------------- the chrome ---

check('HomeScreen imports the primitives', /import \{[^}]*Chip[^}]*ListRow[^}]*\} from '\.\.\/ui'/.test(home));
// The chrome pills are Chip-sized (36px, fully round). MapPill is the 26px
// label that sits ON the map - using it up here made the row ragged against
// a 42px avatar, which is how the mis-mapping showed itself.
check('the city strip is a filled brand Chip', /<Chip tone=\{connected \? 'brand' : 'default'\} dot>/.test(home));
check('the streak is the gold Chip', /<Chip tone="points"/.test(home));
check('no bespoke pill is left in the chrome', !/borderRadius: 999/.test(home), 'a hand-rolled pill came back');
check('the chrome row is centred', /alignItems: 'center'/.test(home));
check('the city strip still pulses on fresh numbers', /pulse\.interpolate/.test(home) && /transform: \[\{ scale \}\]/.test(home));
check('your own avatar is the solid blue one', /tone="primary"/.test(home));
check('Avatar takes a tone', /export function Avatar\(\{ user, size = 44, tone = 'surface'/.test(ui));

// MenuRow was a private copy of what ListRow now does properly. If it comes
// back, the menu drifts from every other list in the app.
check('MenuRow is gone', !/function MenuRow\(/.test(home));
check('the menu is built from ListRow', (home.match(/<ListRow /g) || []).length >= 4);

// The dot on a pill means live. On the navy brand ground that has to be the
// green that survives it, not the pill's own ink.
check('the live dot is green on the brand chip', /tone === 'brand' \? colors\.brandOk : colors\.ok/.test(ui));
// Filled tones need both a fill and an ink that survives it, or the chip is
// a coloured blob with invisible type - which is exactly what gold did.
for (const tone of ['brand', 'points']) {
  check(`Chip's ${tone} tone is filled`, new RegExp(`${tone}: \\{ ink: colors\\.\\w+, fill: colors\\.\\w+`).test(ui));
}

// ---------------------------------------------------------------- the ramp ---

// The chrome is the most tempting place to re-decide a font size by hand,
// because everything in it is small. It should be reading the ramp instead.
// Chip and ListRow carry their own steps now, so what is left in HomeScreen
// is the menu's own type - and that still has to come from the ramp.
check('HomeScreen reads the type ramp', /TYPE\.title/.test(home) && /TYPE\.meta/.test(home) && /TYPE\.overline/.test(home));
const bespokeType = [...home.matchAll(/fontSize: \d/g)].length;
check('no hand-set font sizes remain in HomeScreen', bespokeType === 0, `${bespokeType} left`);

// The theme's own description drifted once already: it still claimed the
// palette came from the city's coat of arms three layers after it stopped.
check('theme.js describes the palette it actually has', !/palette is taken from the\n\/\/ city's coat of arms/.test(theme));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
