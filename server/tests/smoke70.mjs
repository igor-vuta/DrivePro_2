// DP-A11Y-004: execute shared input naming policy without app dependencies.
// Actual DOM association, label focus and phone input behavior are checked in browser.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { inputAccessibility, webInputLabelStyle } from '../../app/src/inputAccessibility.js';

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}`);
  }
}

const first = inputAccessibility('Phone', { placeholder: '+7 777 777 7777' }, ':field-a:', false);
const second = inputAccessibility('Password', { secureTextEntry: true }, ':field-b:', false);
check('two visible web labels target distinct stable field IDs',
  first.labelFor === first.inputProps.id && second.labelFor === second.inputProps.id && first.labelFor !== second.labelFor);

const nativeLabelStyle = { fontSize: 12.5, lineHeight: 16, marginBottom: 8 };
const webLabelStyle = webInputLabelStyle(nativeLabelStyle);
check('HTML label keeps the 16px type line and compact 8px field gap',
  webLabelStyle.lineHeight === '16px' && webLabelStyle.marginBottom === 8 &&
  webLabelStyle.fontSize === 12.5 && webLabelStyle.display === 'block' &&
  nativeLabelStyle.lineHeight === 16);

const onChangeText = () => {};
const phoneProps = { autoComplete: 'tel', keyboardType: 'phone-pad', onChangeText };
const phone = inputAccessibility('Phone', phoneProps, ':phone:', false);
check('web naming keeps phone autocomplete, type and callback',
  phone.inputProps.autoComplete === 'tel' && phone.inputProps.keyboardType === 'phone-pad' && phone.inputProps.onChangeText === onChangeText);

const explicitId = inputAccessibility('Phone', { id: 'caller-phone', accessibilityLabel: 'Custom phone' }, ':unused:', false);
check('explicit web ID and accessible name win', explicitId.labelFor === 'caller-phone'
  && explicitId.inputProps.id === 'caller-phone' && explicitId.inputProps.accessibilityLabel === 'Custom phone');

const explicitNativeId = inputAccessibility('Phone', { nativeID: 'caller-native-id' }, ':unused:', false);
check('explicit nativeID remains the web association target',
  explicitNativeId.labelFor === 'caller-native-id' && explicitNativeId.inputProps.nativeID === 'caller-native-id'
  && !Object.hasOwn(explicitNativeId.inputProps, 'id'));

const bothIds = inputAccessibility('Phone', { id: 'web-id', nativeID: 'other-id' }, ':unused:', false);
check('web ID takes precedence when both caller IDs exist', bothIds.labelFor === 'web-id' && bothIds.inputProps.id === 'web-id');

const unlabelled = { placeholder: 'Search address…', onChangeText };
const bare = inputAccessibility(undefined, unlabelled, ':unused:', false);
check('unlabelled fields keep caller props without an invented name or ID',
  bare.inputProps === unlabelled && bare.labelFor === undefined && !Object.hasOwn(bare.inputProps, 'id'));

const nativeDefault = inputAccessibility('Телефон', phoneProps, ':unused:', true);
check('native visible label becomes the localized accessible name',
  nativeDefault.inputProps.accessibilityLabel === 'Телефон' && nativeDefault.inputProps.onChangeText === onChangeText);

for (const [name, override] of [
  ['accessibilityLabel', { accessibilityLabel: 'Caller name' }],
  ['accessibilityLabelledBy', { accessibilityLabelledBy: 'external-label' }],
  ['aria-label', { 'aria-label': 'ARIA name' }],
]) {
  const result = inputAccessibility('Visible', override, ':unused:', true);
  check(`native ${name} override survives`, result.inputProps === override && result.labelFor === undefined);
}

// Run the unchanged phone formatter itself; inputAccessibility must not alter
// its value path, while the browser check covers the composed component.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(path.join(root, 'app/src/ui.js'), 'utf8');
const start = source.indexOf('export function formatPhone(');
if (start < 0) throw new Error('Missing formatPhone');
const opening = source.indexOf('{', start);
let depth = 0;
let end = -1;
for (let i = opening; i < source.length; i++) {
  if (source[i] === '{') depth++;
  if (source[i] === '}' && --depth === 0) { end = i + 1; break; }
}
if (end < 0) throw new Error('Unclosed formatPhone');
const formatPhone = vm.runInNewContext(`(${source.slice(start, end).replace('export ', '')})`);
check('phone mask still groups Kazakhstan digits and trunk prefix',
  formatPhone('87771234567') === '+7 777 123 4567' && formatPhone('+7 777 123 4567') === '+7 777 123 4567');
check('international phone digits remain ungrouped', formatPhone('+441234567890') === '+441234567890');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
