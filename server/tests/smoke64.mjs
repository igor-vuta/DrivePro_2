// L64: execute the shared accessibility prop builders without an app runtime.
// The remaining checks pin the web/native boundaries that need a browser and
// screen-reader pass before release.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ui = fs.readFileSync(path.join(root, 'app/src/ui.js'), 'utf8');
const home = fs.readFileSync(path.join(root, 'app/src/screens/HomeScreen.js'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'app/src/screens/AuthScreen.js'), 'utf8');
const profile = fs.readFileSync(path.join(root, 'app/src/screens/ProfileScreen.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'app/src/i18n.js'), 'utf8');
let passed = 0;
let failed = 0;
const check = (label, condition) => {
  if (condition) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}`);
  }
};

// These are plain JS functions even though ui.js itself contains JSX. Extract
// their complete bodies and execute them, so state behavior is checked rather
// than only the spelling of a prop.
const functionSource = (name) => {
  const start = ui.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  const opening = ui.indexOf('{', start);
  let depth = 0;
  for (let i = opening; i < ui.length; i++) {
    if (ui[i] === '{') depth++;
    if (ui[i] === '}' && --depth === 0) return ui.slice(start, i + 1).replace('export ', '');
  }
  throw new Error(`Unclosed ${name}`);
};
const context = vm.createContext({});
vm.runInContext(`${functionSource('buttonAccessibility')}\n${functionSource('expandedAccessibility')}\n${functionSource('selectionAccessibility')}`, context);
const button = context.buttonAccessibility;
const expanded = context.expandedAccessibility;
const selection = context.selectionAccessibility;
const translate = (key) => ({ 'a11y.selected': 'Selected', 'a11y.notSelected': 'Not selected' })[key];

const idle = button('Request ride', false, false, false);
const busy = button('Request ride', false, true, false);
const disabled = button('Request ride', true, false, false);
const busyNative = button('Request ride', false, true, true);
check('loading keeps the web button name and forwards busy+disabled as ARIA',
  busy.accessibilityLabel === 'Request ride' && busy.accessibilityRole === 'button'
  && busy['aria-busy'] === true && busy['aria-disabled'] === true
  && !('accessibilityState' in busy));
check('web idle and disabled states differ',
  idle['aria-busy'] === false && idle['aria-disabled'] === false
  && disabled['aria-disabled'] === true && disabled['aria-busy'] === false);
check('native loading retains its accessibility state',
  busyNative.accessibilityState.busy === true && busyNative.accessibilityState.disabled === true
  && !('aria-busy' in busyNative));

const expandedWeb = expanded(true, false);
const collapsedWeb = expanded(false, false);
const expandedNative = expanded(true, true);
check('web menu expansion is forwarded as ARIA in both states',
  expandedWeb['aria-expanded'] === true && collapsedWeb['aria-expanded'] === false
  && !('accessibilityState' in expandedWeb));
check('native menu expansion retains its accessibility state',
  expandedNative.accessibilityState.expanded === true && !('aria-expanded' in expandedNative));

const selectedWeb = selection(true, false, translate);
const otherWeb = selection(false, false, translate);
const selectedNative = selection(true, true, translate);
check('selection uses valid pressed state on web buttons',
  selectedWeb['aria-pressed'] === true && otherWeb['aria-pressed'] === false
  && !('aria-selected' in selectedWeb) && !('accessibilityValue' in selectedWeb));
check('native selection has spoken state without web ARIA',
  selectedNative.accessibilityValue.text === 'Selected' && !('aria-pressed' in selectedNative));

check('interactive Chip and ListRow declare button role while display bodies do not',
  /if \(!onPress\) return body;[\s\S]*?accessibilityRole="button"/.test(ui)
  && (ui.match(/if \(!onPress\) return body;/g) || []).length >= 2);
check('shared controls expose focused style and reduced-motion handling',
  (ui.match(/focused && focusRing\(\)/g) || []).length >= 4
  && /function useReducedMotion\(/.test(ui)
  && /if \(!on \|\| reducedMotion\)/.test(ui)
  && /if \(reducedMotion\) h\.setValue\(to\)/.test(ui));
check('menu trigger applies platform expansion props; backdrop skips Tab',
  /\.\.\.expandedAccessibility\(menu, Platform\.OS !== 'web'\)/.test(home)
  && /tabIndex=\{-1\} accessible=\{false\}/.test(home));
check('menu returns focus and reduced motion removes modal slide',
  /menuTriggerRef\.current\?\.focus\?\.\(\)/.test(home)
  && /firstActionRef/.test(home)
  && /animationType=\{reducedMotion \? 'none' : 'slide'\}/.test(home));
check('all selection groups supply a contextual label',
  /<Segmented\s+accessibilityLabel=\{t\('profile.language'\)\}/.test(home)
  && /<Segmented\s+accessibilityLabel=\{t\('auth.mode'\)\}/.test(auth)
  && /<Segmented\s+accessibilityLabel=\{t\('profile.language'\)\}/.test(profile));
check('selection and auth labels exist in all three languages',
  ['a11y.selected', 'a11y.notSelected', 'auth.mode'].every((key) =>
    (i18n.match(new RegExp(`'${key}':`, 'g')) || []).length === 3));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
