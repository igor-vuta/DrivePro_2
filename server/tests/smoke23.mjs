// L21 smoke test: the first-run guide, and i18n parity across the app.
//
// A missing translation is invisible in review and shows up as an English
// string (or a raw key) in a Russian UI, so this suite parses app/src/i18n.js
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

// The file is flat object literals: `const en = {` … `};`, then ru, then kk.
function dictKeys(name) {
  const start = i18n.indexOf(`const ${name} = {`);
  if (start < 0) return null;
  const end = i18n.indexOf('\n};', start);
  const body = i18n.slice(start, end);
  return new Set([...body.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));
}

const en = dictKeys('en');
const ru = dictKeys('ru');
const kk = dictKeys('kk');
check(
  'all three dictionaries parse',
  !!en && !!ru && !!kk && en.size > 100 && ru.size > 100 && kk.size > 100,
  `en=${en && en.size} ru=${ru && ru.size} kk=${kk && kk.size}`
);

// ---- guide keys the screen actually renders ----
const STEPS = ['what', 'rider', 'driver', 'points'];
const needed = [...STEPS.flatMap((s) => [`guide.${s}.title`, `guide.${s}.text`]), 'guide.next', 'guide.start', 'guide.skip'];
const missingEn = needed.filter((k) => !en.has(k));
const missingRu = needed.filter((k) => !ru.has(k));
const missingKk = needed.filter((k) => !kk.has(k));
check('every guide key exists in English', missingEn.length === 0, missingEn.join(', '));
check('every guide key exists in Russian', missingRu.length === 0, missingRu.join(', '));
check('every guide key exists in Kazakh', missingKk.length === 0, missingKk.join(', '));

// A translated value identical to the English one is almost always an
// untranslated copy-paste. Proper nouns and formats are exempt.
const EXEMPT = new Set(['profile.carMakePh', 'profile.carModelPh', 'profile.platePh', 'profile.emailPh']);
const val = (dict, key) => {
  const start = i18n.indexOf(`const ${dict} = {`);
  const end = i18n.indexOf('\n};', start);
  const m = i18n.slice(start, end).match(new RegExp(`^\\s*'${key.replace(/\./g, '\\.')}':\\s*'(.*)',?$`, 'm'));
  return m ? m[1] : null;
};
const copyOf = (lang) => needed.filter((k) => !EXEMPT.has(k) && val('en', k) && val('en', k) === val(lang, k));
check('no guide string is left untranslated in Russian', copyOf('ru').length === 0, copyOf('ru').join(', '));
check('no guide string is left untranslated in Kazakh', copyOf('kk').length === 0, copyOf('kk').join(', '));

// ---- dictionary parity across the whole app ----
//
// Plural keys are stored as base.one/.few/.many and each language only carries
// the categories its rule can produce (en: one+many, ru: all three, kk: one,
// because a Kazakh noun stays singular after a numeral). So compare BASE keys
// for coverage, then check each language has exactly the categories it needs.
const CATS = ['one', 'few', 'many'];
const NEEDED = { en: ['one', 'many'], ru: ['one', 'few', 'many'], kk: ['one'] };
const baseOf = (k) => {
  const dot = k.lastIndexOf('.');
  return dot > 0 && CATS.includes(k.slice(dot + 1)) ? k.slice(0, dot) : k;
};
const bases = (set) => new Set([...set].map(baseOf));
const isPlural = (set, base) => [...set].some((k) => k !== base && baseOf(k) === base);

const bEn = bases(en);
const bRu = bases(ru);
const bKk = bases(kk);
const missingFrom = (have, want, label) => {
  const gaps = [...want].filter((k) => !have.has(k));
  check(`nothing is missing from ${label}`, gaps.length === 0, gaps.slice(0, 8).join(', '));
};
missingFrom(bRu, bEn, 'Russian');
missingFrom(bKk, bEn, 'Kazakh');
missingFrom(bEn, bRu, 'English (present in ru)');
missingFrom(bEn, bKk, 'English (present in kk)');

// Every plural key must carry each category its language actually selects,
// or t() would fall through to another language mid-sentence.
const dictsByLang = { en, ru, kk };
const pluralGaps = [];
for (const [lang, set] of Object.entries(dictsByLang)) {
  for (const base of bases(set)) {
    if (!isPlural(set, base)) continue;
    for (const cat of NEEDED[lang]) {
      if (!set.has(`${base}.${cat}`)) pluralGaps.push(`${lang}:${base}.${cat}`);
    }
  }
}
check('every plural key covers its language rule', pluralGaps.length === 0, pluralGaps.slice(0, 8).join(', '));

// A plural key in one language must be plural in all of them - otherwise a
// count reaches a flat string and reads wrong for n = 1.
const pluralBases = new Set([...bEn].filter((b) => isPlural(en, b)));
const notPlural = [];
for (const b of pluralBases) {
  if (!isPlural(ru, b)) notPlural.push(`ru:${b}`);
  if (!isPlural(kk, b)) notPlural.push(`kk:${b}`);
}
check('plural keys are plural in every language', notPlural.length === 0, notPlural.slice(0, 8).join(', '));

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
