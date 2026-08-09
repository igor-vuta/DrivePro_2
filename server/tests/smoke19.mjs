// L17 smoke test: environment separation and the operator panel.
//
// The OTP echo (verification code returned to the caller) is a development
// convenience that would let anyone verify a phone number they do not own, so
// it must default to OFF under NODE_ENV=production and stay explicitly
// overridable in both directions. Also covers the /admin login form wiring.
// Usage: node tests/smoke19.mjs   (spawns one server per environment)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(__dirname, '..', 'src', 'index.js');

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

const running = [];
const cleanup = () => {
  for (const { server, dataDir } of running) {
    try {
      server.kill();
    } catch {}
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
};
process.on('exit', cleanup);

// Boot a server with a private DATA_DIR and collect its startup banner.
async function boot(tag, port, env) {
  const dataDir = path.join(__dirname, `.tmp-data19${tag}`);
  fs.rmSync(dataDir, { recursive: true, force: true });
  const server = spawn(process.execPath, [INDEX], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.push({ server, dataDir });
  let out = '';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server ${tag} did not start: ${out}`)), 8000);
    server.stdout.on('data', (d) => {
      out += String(d);
      if (out.includes('OTP')) {
        clearTimeout(t);
        resolve();
      }
    });
  });
  return {
    banner: out,
    async api(method, p, body, headers = {}) {
      const res = await fetch(`http://localhost:${port}${p}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: res.status, json, text };
    },
  };
}

const registerOn = (srv, phone) =>
  srv.api('POST', '/api/register', { phone, password: 'pass1234', name: 'Aigerim' });

// ---- development default: echo ON ----
const dev = await boot('a', 4130, { NODE_ENV: '' });
const devReg = await registerOn(dev, '+15559990001');
check('dev registration succeeds', devReg.status === 201, JSON.stringify(devReg.json));
check('dev echoes the code back', typeof devReg.json.devCode === 'string' && devReg.json.devCode.length === 4);
check('dev banner reports echo ON', /echo to clients ON/.test(dev.banner), dev.banner);

// ---- production default: echo OFF ----
const prod = await boot('b', 4131, { NODE_ENV: 'production' });
const prodReg = await registerOn(prod, '+15559990002');
check('prod registration still succeeds', prodReg.status === 201, JSON.stringify(prodReg.json));
check('prod needs verification', prodReg.json.needsVerification === true);
check('prod does NOT echo the code', prodReg.json.devCode === undefined, JSON.stringify(prodReg.json));
check('prod banner reports echo OFF', /echo to clients OFF/.test(prod.banner), prod.banner);
check('prod banner has no warning', !prod.banner.includes('!!'), prod.banner);

// ---- explicit override wins in both directions ----
const prodEcho = await boot('c', 4132, { NODE_ENV: 'production', OTP_ECHO: '1' });
const prodEchoReg = await registerOn(prodEcho, '+15559990003');
check('OTP_ECHO=1 re-enables the echo in production', typeof prodEchoReg.json.devCode === 'string');
check('prod echo prints a loud warning', /!! OTP_ECHO is ON in production/.test(prodEcho.banner), prodEcho.banner);

const devQuiet = await boot('d', 4133, { NODE_ENV: '', OTP_ECHO: '0' });
const devQuietReg = await registerOn(devQuiet, '+15559990004');
check('OTP_ECHO=0 disables the echo in development', devQuietReg.json.devCode === undefined);

// ---- operator panel ----
const ADMIN = 'test-admin-token';
const adm = await boot('e', 4134, { NODE_ENV: '', ADMIN_TOKEN: ADMIN });
const page = await adm.api('GET', '/admin');
check('admin page served when ADMIN_TOKEN is set', page.status === 200 && page.text.includes('operator panel'));
check('token field lives in a form', /<form id="login" onsubmit="save\(event\)"/.test(page.text));
check('Enter submits that form', /<button type="submit">Enter<\/button>/.test(page.text));
check('save() prevents the default submit', page.text.includes('if(e) e.preventDefault()'));
check('errors are surfaced, not swallowed', page.text.includes("err(r.status === 401 ? 'Invalid token.'"));

// The panel is a JS template literal in api.js, so an escape that is correct
// in the source can still emit broken JS (a `\'` collapses to a bare quote).
// Compiling the served script - not running it - catches that class of bug:
// it once left the whole panel dead, button and Enter alike.
const script = page.text.slice(page.text.lastIndexOf('<script>') + 8, page.text.lastIndexOf('</script>'));
let scriptError = null;
try {
  new Function(script); // eslint-disable-line no-new-func
} catch (e) {
  scriptError = e.message;
}
check('served admin script parses', scriptError === null, scriptError || '');
check('ban() handler quotes its argument', /onclick="ban\(&quot;'\+u\.id\+'&quot;,/.test(script));

const badTok = await adm.api('GET', '/api/admin/overview', null, { 'x-admin-token': 'nope' });
check('overview rejects a wrong token with 401', badTok.status === 401, String(badTok.status));
const goodTok = await adm.api('GET', '/api/admin/overview', null, { 'x-admin-token': ADMIN });
check('overview accepts the right token', goodTok.status === 200 && typeof goodTok.json.totalUsers === 'number');

// Without ADMIN_TOKEN the panel does not exist: /admin falls through to the
// web app (SPA catch-all), and the API itself 404s rather than admitting it.
const noAdmin = await boot('f', 4135, { NODE_ENV: '' });
const hidden = await noAdmin.api('GET', '/admin');
check('operator panel not served without ADMIN_TOKEN', !hidden.text.includes('operator panel'));
const hiddenApi = await noAdmin.api('GET', '/api/admin/overview', null, { 'x-admin-token': ADMIN });
check('admin API 404s without ADMIN_TOKEN', hiddenApi.status === 404, String(hiddenApi.status));

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
