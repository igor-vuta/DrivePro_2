// L19 smoke test: the built web app's viewport contract and bundle hygiene.
//
// app/dist is committed and served straight from the VM, so a bad export is a
// production bug with no build step to catch it. This suite checks the shipped
// index.html rather than the source: the dvh/safe-area rules that stop mobile
// browser chrome from covering the app, and the CLAUDE.md rule that an export
// must leave exactly one bundle behind (the filename is content-hashed, so a
// forgotten delete silently doubles the directory).
// Usage: node tests/smoke21.mjs   (no server needed for most of it)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const DIST = path.join(REPO, 'app', 'dist');
const INDEX = path.join(DIST, 'index.html');
const PORT = 4137;
const DATA_DIR = path.join(__dirname, '.tmp-data21');

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

// ------------------------------------------------------------ the export ---

check('a web build is committed', fs.existsSync(INDEX));
const html = fs.readFileSync(INDEX, 'utf8');

// env(safe-area-inset-*) only resolves when the viewport covers the notch.
check('viewport opts into the display cutout', html.includes('viewport-fit=cover'), 'missing viewport-fit=cover');

// Viewport height units do not survive mobile: height:100% resolves against
// the large viewport (bottom hides under a collapsing URL bar) and 100dvh
// comes back short of the web view in an iOS standalone PWA, leaving a dead
// band below the app. Laying the root out against the layout viewport with
// position:fixed + inset:0 avoids both.
check('root is pinned to the layout viewport', /#root\{position:fixed;top:0;right:0;bottom:0;left:0;/.test(html), 'missing the fixed-inset rule');
// An explicit height would win over `bottom:0` and reintroduce the gap.
check('the root height stays auto', /#root\{[^}]*height:auto/.test(html), 'root has an explicit height again');
check('no viewport-height unit sizes the app', !/#root\{[^}]*100dvh/.test(html) && !/html,body,#root\{height/.test(html));
check('overscroll bounce is disabled', /html,body\{height:100%;overflow:hidden;overscroll-behavior:none\}/.test(html));
// Painted before the bundle loads so the first frame is not a white flash in
// dark mode, nor a black one in light.
// Read out of theme.js rather than written down here: hardcoded values made
// this fail the moment L61 changed the palette, which is the one thing a
// pinned contract must not do - the ground moved and the test could not tell.
const themeSrc = fs.readFileSync(path.join(REPO, 'app', 'src', 'theme.js'), 'utf8');
const bgOf = (name) =>
  /^ {2}bg: '(#[0-9A-Fa-f]{6})',$/m.exec(themeSrc.split(`const ${name} = {`)[1].split('\n};')[0])?.[1];
const [lightBg, darkBg] = [bgOf('light'), bgOf('dark')];
check('the ground colour is painted before JS runs', html.includes(`html,body{background:${lightBg}}`), `expected ${lightBg}`);
check('and a dark one for dark mode', html.includes(`@media (prefers-color-scheme: dark){html,body{background:${darkBg}}}`), `expected ${darkBg}`);
check('both theme-colors are declared', (html.match(/name="theme-color"/g) || []).length === 2, html.match(/theme-color[^>]*/g));

// The override has to come after Expo's reset or it loses on equal specificity.
check(
  'the override follows the expo reset',
  html.indexOf('position:fixed') > html.indexOf('id="expo-reset"'),
  'the root rule appears before #expo-reset'
);

// --------------------------------------------------------------- bundles ---

const jsDir = path.join(DIST, '_expo', 'static', 'js', 'web');
const bundles = fs.existsSync(jsDir) ? fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')) : [];
check('exactly one bundle is committed', bundles.length === 1, `found ${bundles.length}: ${bundles.join(', ')}`);
check(
  'index.html points at the committed bundle',
  bundles.length === 1 && html.includes(bundles[0]),
  `html references something other than ${bundles[0]}`
);

// ---------------------------------------------------- postexport is idempotent ---

const postexport = path.join(REPO, 'app', 'tools', 'postexport.mjs');
const before = fs.readFileSync(INDEX, 'utf8');
const rerun = spawn(process.execPath, [postexport], { cwd: path.join(REPO, 'app'), stdio: 'pipe' });
await new Promise((resolve) => rerun.on('exit', resolve));
const after = fs.readFileSync(INDEX, 'utf8');
check('re-running postexport changes nothing', before === after, 'postexport is not idempotent');
check('the marker is present exactly once', (after.match(/drivepro:pwa/g) || []).length === 1);

// ------------------------------------------------------- served over HTTP ---

fs.rmSync(DATA_DIR, { recursive: true, force: true });
const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start')), 8000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('running')) {
      clearTimeout(t);
      resolve();
    }
  });
});
const cleanup = () => {
  try {
    server.kill();
  } catch {}
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
};
process.on('exit', cleanup);

const served = await fetch(`http://localhost:${PORT}/`).then((r) => r.text());
check('the server serves the built index.html', served.includes('position:fixed') && served.includes('viewport-fit=cover'));
const bundleRes = await fetch(`http://localhost:${PORT}/_expo/static/js/web/${bundles[0]}`);
check('the bundle it references is actually served', bundleRes.status === 200, String(bundleRes.status));

// Safe-area padding must come from exactly one place. react-native-web's
// SafeAreaView already applies env(safe-area-inset-*) on all four sides, so
// adding it again inside Screen doubled the notch and home-indicator gaps on
// iOS - which is what the reported "margins top and bottom" actually were.
const ui = fs.readFileSync(path.join(REPO, 'app', 'src', 'ui.js'), 'utf8');
check('Screen is a SafeAreaView', /<SafeAreaView style=\{\[s\.screen, style\]\}>/.test(ui));
// Match a style declaration, not the comment explaining why there isn't one.
const doubled = ui.match(/padding[A-Za-z]*:\s*'[^']*safe-area-inset[^']*'/g) || [];
check(
  'the inset is not applied a second time inside it',
  doubled.length === 0,
  `ui.js re-applies it: ${doubled.join(', ')}`
);

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
