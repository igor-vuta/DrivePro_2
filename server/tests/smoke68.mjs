// DP-UI-002: execute action-name and error-announcement prop builders without
// requiring app dependencies in the Node smoke runner. Browser behavior is
// checked separately.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const schedules = read('app/src/screens/SchedulesScreen.js');
const ui = read('app/src/ui.js');
const i18n = read('app/src/i18n.js');
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

function functionSource(source, name) {
  const start = source.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  const opening = source.indexOf('{', start);
  let depth = 0;
  for (let i = opening; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1).replace('export ', '');
  }
  throw new Error(`Unclosed ${name}`);
}

function dictionary(name) {
  const match = i18n.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n\\});`));
  if (!match) throw new Error(`Missing ${name} dictionary`);
  return vm.runInNewContext(`(${match[1]})`);
}

const context = vm.createContext({});
vm.runInContext(
  `${functionSource(schedules, 'commuteActionAccessibility')}\n${functionSource(ui, 'errorAnnouncementAccessibility')}`,
  context
);
const action = context.commuteActionAccessibility;
const errorProps = context.errorAnnouncementAccessibility;
const active = { active: true, time: '08:30', dest: { address: 'Synthetic destination' } };
const paused = { ...active, active: false };

for (const lang of ['en', 'ru', 'kk']) {
  const dict = dictionary(lang);
  const translate = (key, params) => {
    const template = dict[key];
    return template && template.replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
  };
  const pause = action(active, 'toggle', translate);
  const resume = action(paused, 'toggle', translate);
  const remove = action(active, 'remove', translate);
  check(`${lang} actions have a button role and distinct localized names`,
    [pause, resume, remove].every((props) => props.accessibilityRole === 'button'
      && props.accessibilityLabel.includes('Synthetic destination')
      && props.accessibilityLabel.includes('08:30'))
    && new Set([pause.accessibilityLabel, resume.accessibilityLabel, remove.accessibilityLabel]).size === 3);
}

const missingAddress = action({ ...active, dest: {} }, 'toggle', (key, params) => params.destination);
check('missing destination still yields a stable action name', missingAddress.accessibilityLabel === '—');

const webError = errorProps(false);
const nativeError = errorProps(true);
check('web errors expose one alert role', webError.role === 'alert' && Object.keys(webError).length === 1);
check('native errors expose one live-region prop',
  nativeError.accessibilityLiveRegion === 'assertive' && Object.keys(nativeError).length === 1);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
