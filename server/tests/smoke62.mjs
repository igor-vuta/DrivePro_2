// L62 smoke test: the primitives the redesigned screens are built from.
//
// Sheet, ListRow, MapPill and SelectRow are new, and Title/Sub gained steps.
// None of it can be imported here (react-native), so this reads app/src/ui.js
// as text and pins the things that are cheap to break and expensive to notice:
// the exports themselves, the snap-point contract, and - most of all - that
// every new style went into makeStyles() rather than module scope, which is
// the one mistake this codebase's mutable `colors` object punishes silently.
// Usage: node tests/smoke62.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI = path.join(__dirname, '..', '..', 'app', 'src', 'ui.js');

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

const src = fs.readFileSync(UI, 'utf8');

// ---------------------------------------------------------------- exports ---

for (const name of ['Sheet', 'ListRow', 'MapPill', 'SelectRow']) {
  check(`ui exports ${name}`, new RegExp(`^export function ${name}\\(`, 'm').test(src));
}
check('ui exports SHEET_SNAPS', /^export const SHEET_SNAPS = \{/m.test(src));

// ------------------------------------------------------------------ steps ---

check('Title takes a step', /export function Title\(\{[^}]*step = 'display'/.test(src));
check('Title still supports glow', /export function Title\(\{[^}]*glow/.test(src));
check('Sub takes a step', /export function Sub\(\{[^}]*step = 'sub'/.test(src));
check('Sub takes a tone', /export function Sub\(\{[^}]*tone/.test(src));
for (const step of ['titleSm', 'meta', 'overline']) {
  check(`the ${step} step has a style`, new RegExp(`^ {2}${step}: \\{`, 'm').test(src));
}

// ------------------------------------------------------------------- snap ---

const snapBlock = src.split('export const SHEET_SNAPS = {')[1]?.split('};')[0] ?? '';
const snaps = {};
for (const m of snapBlock.matchAll(/(\w+): ([\d.]+)/g)) snaps[m[1]] = Number(m[2]);
check('three snap points', Object.keys(snaps).length === 3, Object.keys(snaps).join(','));
check('snap points are named peek/half/full', ['peek', 'half', 'full'].every((k) => k in snaps));
check('snap points ascend', snaps.peek < snaps.half && snaps.half < snaps.full, JSON.stringify(snaps));
check(
  'snap points are fractions of the box',
  Object.values(snaps).every((v) => v > 0 && v <= 1),
  JSON.stringify(snaps)
);
// The drag has to be able to reach both ends, or a stop is unreachable and the
// sheet feels stuck.
check('the drag clamps to the outer stops', /Math\.min\(at\('full'\), Math\.max\(at\('peek'\)/.test(src));
check('a flick changes stop', /Math\.abs\(g\.vy\) > /.test(src));
check('Sheet reports where a drag landed', /onSnapChange\(name\)/.test(src));
// height cannot be driven natively; a copy-pasted useNativeDriver:true here
// throws at runtime the first time the sheet moves.
check('the height animation is not native-driven', !/toValue: to, useNativeDriver: true/.test(src));

// ------------------------------------------------------------------ tokens ---

// Every skin the new primitives can take must name real tokens; a typo renders
// `undefined`, which react-native-web quietly paints as transparent.
const THEME = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'src', 'theme.js'), 'utf8');
const declared = new Set();
for (const m of THEME.split('const light = {')[1].split('\n};')[0].matchAll(/^ {2}(\w+):/gm)) declared.add(m[1]);
const usedInUi = new Set();
for (const m of src.matchAll(/\bcolors\.([a-zA-Z]\w*)/g)) usedInUi.add(m[1]);
const unknown = [...usedInUi].filter((k) => !declared.has(k));
check('every token ui.js reads is declared', unknown.length === 0, unknown.join(', '));

for (const tone of ['brand', 'ok', 'go', 'plain']) {
  check(`MapPill has a ${tone} tone`, new RegExp(`${tone}: \\{ bg: colors\\.`).test(src));
}

// ------------------------------------------------------- the mutable-colors rule ---

// CLAUDE.md's standing rule: anything built with StyleSheet.create captures
// colors once, so it must live in makeStyles() and be rebuilt by
// refreshStyles(). Exactly one StyleSheet.create, inside that function.
check('exactly one StyleSheet.create', (src.match(/StyleSheet\.create/g) || []).length === 1);
check('it lives in makeStyles', /const makeStyles = \(\) =>\s*\n?\s*StyleSheet\.create/.test(src));
check('refreshStyles rebuilds it', /export function refreshStyles\(\) \{\s*\n\s*s = makeStyles\(\);/.test(src));

// Every new style key the primitives reference must actually exist in the
// sheet, or the component renders unstyled.
const styleBlock = src.split('const makeStyles = () =>')[1] ?? '';
for (const key of [
  'mapPill', 'mapPillDot', 'listRow', 'listRowSelected', 'listTile', 'listDot',
  'listBody', 'listTitle', 'listTrailing', 'sheetBox', 'sheet', 'sheetGrip',
  'sheetGripBar', 'sheetHeader', 'sheetBody',
]) {
  check(`style ${key} is defined`, new RegExp(`^ {2}${key}: [\\{(]`, 'm').test(styleBlock));
}

// A MapPill is annotation and a Chip is a control; if their radii ever
// converge the distinction the design rests on is gone.
const radiusOf = (key) => {
  const m = new RegExp(`^ {2}${key}: \\{[^}]*borderRadius: ([\\d.]+)`, 'ms').exec(styleBlock);
  return m ? Number(m[1]) : null;
};
check('MapPill is squarer than Chip', radiusOf('mapPill') < radiusOf('chip'), `${radiusOf('mapPill')} vs ${radiusOf('chip')}`);
check('the sheet has a rounded top only', /borderTopLeftRadius: 30/.test(styleBlock) && !/^ {2}sheet: \{[^}]*borderBottomLeftRadius/ms.test(styleBlock));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
