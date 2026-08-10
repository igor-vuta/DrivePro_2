// L22 smoke test: plural rules and the Kazakh wiring.
//
// Russian plural selection is the kind of thing that looks right on the three
// numbers you happen to try and is wrong on 11 or 112, so the rule is pinned
// here across the awkward ranges. Kazakh keeps a noun singular after any
// numeral, which is why its dictionary carries only `.one`.
// Usage: node tests/smoke24.mjs   (no server needed)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluralCategory } from '../../app/src/plurals.js';

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

const cats = (lang, ns) => ns.map((n) => pluralCategory(lang, n)).join(',');

// ---- English ----
check('en: 1 is one', pluralCategory('en', 1) === 'one');
check('en: 0 and 2+ are many', cats('en', [0, 2, 5, 11, 21, 100]) === 'many,many,many,many,many,many');

// ---- Russian ----
check('ru: 1, 21, 31, 101 take the singular', cats('ru', [1, 21, 31, 101]) === 'one,one,one,one');
check('ru: 2-4 and 22-24 take the paucal', cats('ru', [2, 3, 4, 22, 23, 24]) === 'few,few,few,few,few,few');
check('ru: 5-20 take the plural', cats('ru', [5, 9, 10, 20]) === 'many,many,many,many');
// The teens are the trap: they end in 1-4 but are still `many`.
check('ru: the teens are plural, not singular', cats('ru', [11, 12, 13, 14]) === 'many,many,many,many');
check('ru: 111-114 follow the teens', cats('ru', [111, 112, 113, 114]) === 'many,many,many,many');
check('ru: 0 is plural', pluralCategory('ru', 0) === 'many');

// ---- Kazakh ----
check('kk: every count uses one form', cats('kk', [0, 1, 2, 5, 11, 21, 112]) === 'one,one,one,one,one,one,one');

// ---- defensive ----
check('an unknown language falls back to the en rule', pluralCategory('de', 1) === 'one' && pluralCategory('de', 5) === 'many');
check('a non-numeric count does not throw', pluralCategory('ru', undefined) === 'many');

// ---- the Kazakh wiring ----
const i18n = fs.readFileSync(path.join(APP, 'src', 'i18n.js'), 'utf8');
check('kk is a registered dictionary', /const dicts = \{ ru, kk, en \}/.test(i18n));
check('a kk device language resolves to kk', /dev\.startsWith\('kk'\)/.test(i18n));
check('anything unrecognised still lands on Russian', /return dev\.startsWith\('en'\) \? 'en' : 'ru'/.test(i18n));
// Kazakh readers are far likelier to read Russian than English, so kk misses
// should fall through to ru rather than straight to the en base.
check('kk falls back to ru before en', /current === 'kk' \? \[dicts\.kk, ru, en\]/.test(i18n));

const profile = fs.readFileSync(path.join(APP, 'src', 'screens', 'ProfileScreen.js'), 'utf8');
check('the picker offers Kazakh', /\{ value: 'kk', label: 'ҚАЗ' \}/.test(profile));
const order = ['auto', 'ru', 'kk', 'en'].map((v) => profile.indexOf(`value: '${v}'`));
check('the picker reads Auto, RU, KK, EN', order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), order.join(','));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
