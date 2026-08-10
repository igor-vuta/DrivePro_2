// L21 smoke test: the first-run guide, and i18n parity across the app.
//
// A missing translation is invisible in review and shows up as an English
// string (or a raw key) in a Russian UI, so this suite parses app/src/i18n.js
// and checks that every key the guide renders exists in BOTH dictionaries -
// then generalises: no key may exist in one dictionary and not the other.
// Also pins the guide's place in the boot sequence (before the permission ask,
// once only, skippable), which is App.js control flow with no server to query.
// Usage: node tests/smoke23.mjs   (no server needed)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(__dirname, '..', '..', 'app');

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

const i18n = fs.readFileSync(path.join(APP, 'src', 'i18n.js'), 'utf8');

// The file is two flat object literals: `const en = {` … `};` then `const ru = {`.
function dictKeys(name) {
  const start = i18n.indexOf(`const ${name} = {`);
  if (start < 0) return null;
  const end = i18n.indexOf('\n};', start);
  const body = i18n.slice(start, end);
  return new Set([...body.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));
}

const en = dictKeys('en');
const ru = dictKeys('ru');
check('both dictionaries parse', !!en && !!ru && en.size > 100 && ru.size > 100, `en=${en && en.size} ru=${ru && ru.size}`);

// ---- guide keys the screen actually renders ----
const STEPS = ['what', 'rider', 'driver', 'points'];
const needed = [...STEPS.flatMap((s) => [`guide.${s}.title`, `guide.${s}.text`]), 'guide.next', 'guide.start', 'guide.skip'];
const missingEn = needed.filter((k) => !en.has(k));
const missingRu = needed.filter((k) => !ru.has(k));
check('every guide key exists in English', missingEn.length === 0, missingEn.join(', '));
check('every guide key exists in Russian', missingRu.length === 0, missingRu.join(', '));

// A Russian value identical to the English one is almost always an untranslated
// copy-paste. Proper nouns and formats are exempt.
const EXEMPT = new Set(['profile.carMakePh', 'profile.carModelPh', 'profile.platePh', 'profile.emailPh']);
const val = (dict, key) => {
  const start = i18n.indexOf(`const ${dict} = {`);
  const end = i18n.indexOf('\n};', start);
  const m = i18n.slice(start, end).match(new RegExp(`^\\s*'${key.replace(/\./g, '\\.')}':\\s*'(.*)',?$`, 'm'));
  return m ? m[1] : null;
};
const untranslated = needed.filter((k) => !EXEMPT.has(k) && val('en', k) && val('en', k) === val('ru', k));
check('no guide string is left untranslated', untranslated.length === 0, untranslated.join(', '));

// ---- dictionary parity across the whole app ----
const onlyEn = [...en].filter((k) => !ru.has(k));
const onlyRu = [...ru].filter((k) => !en.has(k));
check('no key exists only in English', onlyEn.length === 0, onlyEn.slice(0, 8).join(', '));
check('no key exists only in Russian', onlyRu.length === 0, onlyRu.slice(0, 8).join(', '));

// ---- the guide's place in the boot sequence ----
const app = fs.readFileSync(path.join(APP, 'App.js'), 'utf8');
check('the guide is rendered', /if \(guideState === 'needed'\) return <GuideScreen/.test(app));
check(
  'it comes before the permission ask',
  app.indexOf("guideState === 'needed'") < app.indexOf("permState === 'needed'"),
  'guide renders after permissions'
);
check('it waits for both flags before showing the app', /permState === 'unknown' \|\| guideState === 'unknown'/.test(app));
check('completion is persisted', /AsyncStorage\.setItem\(GUIDE_KEY, '1'\)/.test(app));
check('its storage key is distinct from the permission one', /GUIDE_KEY = 'drivepro\.guideDone'/.test(app) && /PERM_KEY = 'drivepro\.permDone'/.test(app));

// A storage failure must not lock a signed-in user out of the app.
check('a storage error does not block sign-in', /\.catch\(\(\) => \{\s*if \(!cancelled\) setGuideState\('done'\)/.test(app));

const guide = fs.readFileSync(path.join(APP, 'src', 'screens', 'GuideScreen.js'), 'utf8');
check('the guide is skippable', /title=\{t\('guide\.skip'\)\}/.test(guide));
check('the last step starts the app instead of skipping', /last \? onDone\(\) : setI/.test(guide));
check('all four steps are wired', /const STEPS = \['what', 'rider', 'driver', 'points'\]/.test(guide));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
