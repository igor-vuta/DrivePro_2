// Deploy-prep smoke test: static web app serving on the same server as the
// API. Usage: node tests/smoke7.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4107;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data7');
const WEB_DIR = path.join(__dirname, '.tmp-web7');

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

// fake web build
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.rmSync(WEB_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(WEB_DIR, '_expo', 'static', 'js'), { recursive: true });
fs.writeFileSync(path.join(WEB_DIR, 'index.html'), '<!DOCTYPE html><html><body>DrivePro web shell</body></html>');
fs.writeFileSync(path.join(WEB_DIR, '_expo', 'static', 'js', 'app-abc123.js'), 'console.log("app");');
fs.writeFileSync(path.join(WEB_DIR, 'favicon.ico'), 'x');

const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR, WEB_DIR },
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
  fs.rmSync(WEB_DIR, { recursive: true, force: true });
};
process.on('exit', cleanup);

const get = async (p) => {
  const res = await fetch(BASE + p);
  const text = await res.text();
  return { status: res.status, text, type: res.headers.get('content-type') || '', cache: res.headers.get('cache-control') || '' };
};

{
  const r = await get('/');
  check('root serves the web app', r.status === 200 && r.text.includes('DrivePro web shell') && r.type.includes('text/html'));
  check('index.html is not cached', r.cache.includes('no-cache'));

  const js = await get('/_expo/static/js/app-abc123.js');
  check('hashed asset served with long cache', js.status === 200 && js.type.includes('javascript') && js.cache.includes('immutable'));

  const spa = await get('/some/client/route');
  check('unknown route falls back to app shell (SPA)', spa.status === 200 && spa.text.includes('DrivePro web shell'));

  const trav = await get('/..%2f..%2fpackage.json');
  check('path traversal contained', trav.status === 200 && !trav.text.includes('"name"'));

  const apiHealth = await get('/api/health');
  check('API still answers under /api', apiHealth.status === 200 && apiHealth.text.includes('"ok":true'));

  const api404 = await get('/api/nonexistent');
  check('unknown API route stays a JSON 404 (no SPA fallback)', api404.status === 404 && api404.text.includes('not found'));
}

// without a build, the root falls back to the JSON banner
{
  fs.rmSync(path.join(WEB_DIR, 'index.html'));
  const r = await get('/');
  check('no build -> JSON banner with hint', r.status === 200 && r.text.includes('not built'));
}

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
