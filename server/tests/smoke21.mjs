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

// height:100% resolves against the large viewport on mobile, so the bottom of
// the app hides under the collapsing URL bar. dvh tracks the visible viewport.
check('root is sized with dvh', /html,body,#root\{height:100%;height:100dvh\}/.test(html), 'missing the dvh rule');
check('the 100% fallback comes first', html.indexOf('height:100%;height:100dvh') > -1);
check('overscroll bounce is disabled', /body\{overscroll-behavior:none\}/.test(html));
check('dark background is painted before JS runs', /html,body\{background:#06070d\}/.test(html));

// The override has to come after Expo's reset or it loses on equal specificity.
check(
  'the override follows the expo reset',
  html.indexOf('100dvh') > html.indexOf('id="expo-reset"'),
  'dvh rule appears before #expo-reset'
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
check('the server serves the built index.html', served.includes('100dvh') && served.includes('viewport-fit=cover'));
const bundleRes = await fetch(`http://localhost:${PORT}/_expo/static/js/web/${bundles[0]}`);
check('the bundle it references is actually served', bundleRes.status === 200, String(bundleRes.status));

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
