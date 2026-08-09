// L11 smoke test: identity & install kit. The server must ship a complete
// PWA install surface: manifest with maskable icons, themed index.html in
// Russian, apple-touch icon, favicon - and the Expo/EAS config must point
// at real image assets so native builds get the same identity.
// Usage: node tests/smoke15.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const PORT = 4116;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data15');

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

fs.rmSync(DATA_DIR, { recursive: true, force: true });
const server = spawn(process.execPath, [path.join(ROOT, 'server', 'src', 'index.js')], {
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

const get = async (p) => {
  const res = await fetch(BASE + p);
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get('content-type') || '', buf };
};
const isPng = (buf) => buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

// ---- served install surface ----
const home = await get('/');
const html = home.buf.toString('utf8');
check('index.html served', home.status === 200 && home.type.includes('text/html'));
check('document language is Russian', html.includes('<html lang="ru">'));
check('manifest is linked', html.includes('rel="manifest"') && html.includes('/manifest.json'));
check('theme-color matches the night bg', html.includes('name="theme-color"') && html.includes('#06070d'));
check('iOS standalone meta present', html.includes('apple-mobile-web-app-capable') && html.includes('black-translucent'));
check('apple-touch-icon linked', html.includes('rel="apple-touch-icon"'));
check('viewport covers the notch', html.includes('viewport-fit=cover'));

const man = await get('/manifest.json');
check('manifest served as JSON', man.status === 200 && man.type.includes('json'));
let manifest = null;
try {
  manifest = JSON.parse(man.buf.toString('utf8'));
} catch {}
check('manifest parses', !!manifest);
check('manifest identity', manifest?.name === 'DrivePro' && manifest?.short_name === 'DrivePro');
check('manifest installs standalone', manifest?.display === 'standalone' && manifest?.start_url === '/');
check('manifest is themed', manifest?.theme_color === '#06070d' && manifest?.background_color === '#06070d');
const purposes = (manifest?.icons || []).map((i) => i.purpose);
check('manifest has any + maskable icons', purposes.includes('any') && purposes.includes('maskable'));

for (const p of ['/icons/icon-192.png', '/icons/icon-512.png', '/apple-touch-icon.png']) {
  const r = await get(p);
  check(`${p} is a real PNG`, r.status === 200 && r.type === 'image/png' && isPng(r.buf) && r.buf.length > 4000);
}
const i512 = await get('/icons/icon-512.png');
const dim = isPng(i512.buf) ? pngSize(i512.buf) : { w: 0, h: 0 };
check('icon-512 is 512x512', dim.w === 512 && dim.h === 512);

const ico = await get('/favicon.ico');
check('favicon.ico served', ico.status === 200 && ico.type === 'image/x-icon' && ico.buf.length > 500);

const sw = await get('/sw.js');
check('service worker still served', sw.status === 200 && sw.type.includes('javascript'));

// ---- native build identity (Expo + EAS config) ----
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'app.json'), 'utf8')).expo;
check('expo icon wired', appJson.icon === './assets/icon.png');
check('expo dark identity', appJson.userInterfaceStyle === 'dark' && appJson.backgroundColor === '#06070d');
check('android package set', /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(appJson.android?.package || ''));
check('android adaptive icon wired', appJson.android?.adaptiveIcon?.foregroundImage === './assets/adaptive-icon.png'
  && appJson.android?.adaptiveIcon?.backgroundColor === '#06070d');

for (const rel of ['assets/icon.png', 'assets/adaptive-icon.png', 'assets/favicon.png']) {
  const f = path.join(ROOT, 'app', rel);
  check(`${rel} exists and is a PNG`, fs.existsSync(f) && isPng(fs.readFileSync(f)));
}
const master = fs.readFileSync(path.join(ROOT, 'app', 'assets', 'icon.png'));
const msz = pngSize(master);
check('native icon is 1024x1024', msz.w === 1024 && msz.h === 1024);

const eas = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'eas.json'), 'utf8'));
check('eas preview builds an APK', eas.build?.preview?.android?.buildType === 'apk');
check('eas production builds an app bundle', eas.build?.production?.android?.buildType === 'app-bundle');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
