// L25 smoke test: real SMS delivery via Twilio.
//
// The point of this layer is to close the hole where anyone could verify a
// phone number they do not own, so the assertions that matter are: with a
// provider configured the code STOPS being echoed to the client, the message
// actually goes to the provider addressed to the right number, and a provider
// refusal is reported instead of leaving the user waiting for a code that
// will never arrive.
//
// TWILIO_API_URL points at a stub, so no message is ever really sent and no
// real credentials are involved - the SID and token here are fake.
// Usage: node tests/smoke26.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TWILIO_PORT = 4141;
const FAKE_SID = 'ACfake0000000000000000000000000000';
const FAKE_TOKEN = 'fake-auth-token';

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

// ---- stub Twilio ----
let sent = [];
let reply = { status: 201, body: { sid: 'SM123', status: 'queued' } };
const twilio = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    sent.push({
      url: req.url,
      auth: req.headers.authorization || '',
      params: Object.fromEntries(new URLSearchParams(raw)),
    });
    res.writeHead(reply.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
});
await new Promise((r) => twilio.listen(TWILIO_PORT, r));

const servers = [];
const cleanup = () => {
  for (const { proc, dir } of servers) {
    try {
      proc.kill();
    } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
  try {
    twilio.close();
  } catch {}
};
process.on('exit', cleanup);

async function boot(tag, port, env) {
  const dir = path.join(__dirname, `.tmp-data26${tag}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servers.push({ proc, dir });
  let out = '';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server ${tag} did not start: ${out}`)), 8000);
    proc.stdout.on('data', (d) => {
      out += String(d);
      if (out.includes('OTP:') || out.includes('!!')) {
        clearTimeout(t);
        resolve();
      }
    });
  });
  return {
    banner: out,
    async api(method, p, body) {
      const res = await fetch(`http://localhost:${port}${p}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      let json = null;
      try {
        json = await res.json();
      } catch {}
      return { status: res.status, json };
    },
  };
}

const TWILIO_ENV = {
  TWILIO_ACCOUNT_SID: FAKE_SID,
  TWILIO_AUTH_TOKEN: FAKE_TOKEN,
  TWILIO_FROM: '+15550001111',
  TWILIO_API_URL: `http://localhost:${TWILIO_PORT}`,
};
const register = (srv, phone) => srv.api('POST', '/api/register', { phone, password: 'pass1234', name: 'Aigerim' });

// ------------------------------------------------- provider not configured ---

const mock = await boot('a', 4142, { NODE_ENV: '' });
const mockReg = await register(mock, '+77015558001');
check('without a provider the code is still echoed in dev', typeof mockReg.json.devCode === 'string');
check('the banner names the mock provider', /SMS:\s+mock/.test(mock.banner), mock.banner);

// ------------------------------------------------------ provider configured ---

sent = [];
const live = await boot('b', 4143, { NODE_ENV: '', ...TWILIO_ENV });

// This is the whole point of the layer: a real provider turns the echo off by
// itself, without needing NODE_ENV=production or an explicit OTP_ECHO=0.
check('configuring SMS turns the echo off on its own', /echo to clients OFF/.test(live.banner), live.banner);
check('the banner names twilio', /SMS:\s+twilio/.test(live.banner), live.banner);
check('the banner does not leak the auth token', !live.banner.includes(FAKE_TOKEN));
check('the banner truncates the account sid', !live.banner.includes(FAKE_SID), live.banner);

const liveReg = await register(live, '+77015558002');
check('registration succeeds', liveReg.status === 201, JSON.stringify(liveReg.json));
check('the code is NOT echoed to the client', liveReg.json.devCode === undefined, JSON.stringify(liveReg.json));
check('exactly one message was sent', sent.length === 1, `${sent.length}`);

const msg = sent[0] || { params: {}, auth: '', url: '' };
check('it went to the right number', msg.params.To === '+77015558002', msg.params.To);
check('it came from the configured sender', msg.params.From === '+15550001111', msg.params.From);
check('it contains a 4-digit code', /\b\d{4}\b/.test(msg.params.Body || ''), msg.params.Body);
check('it is addressed to the account endpoint', msg.url.includes(FAKE_SID), msg.url);

const [scheme, blob] = msg.auth.split(' ');
check('it authenticates with HTTP Basic', scheme === 'Basic' && !!blob);
check(
  'the basic credentials are the configured pair',
  Buffer.from(blob || '', 'base64').toString() === `${FAKE_SID}:${FAKE_TOKEN}`
);

// The client is told to expect an SMS, so the code must not come back another
// way either - a verify with a guessed code must still fail.
const guess = await live.api('POST', '/api/verify', { phone: '+77015558002', code: '0000' });
check('a guessed code is rejected', guess.status === 400 || guess.status === 429, String(guess.status));

// ------------------------------------------------------- provider refusals ---

// 21608 = trial account, recipient not verified. A refusal must surface.
sent = [];
reply = { status: 400, body: { code: 21608, message: 'The number is unverified', status: 400 } };
const refused = await register(live, '+77015558003');
check('a provider refusal is reported to the caller', refused.status === 502 && refused.json.code === 'sms_failed', JSON.stringify(refused.json));
check('the refusal still reached the provider', sent.length === 1);

// A refusal must not start the resend cooldown: the user never got a code,
// so making them wait 30s before retrying would strand them.
reply = { status: 201, body: { sid: 'SM124', status: 'queued' } };
sent = [];
const retry = await live.api('POST', '/api/resend', { phone: '+77015558003' });
check('a refusal does not start the resend cooldown', retry.status === 200, JSON.stringify(retry.json));
check('the retry was actually sent', sent.length === 1);
check('the retry does not echo the code either', retry.json.devCode === undefined);

// ------------------------------------------------ sender formats accepted ---

// Pasted straight from the Twilio console, spaces and all.
sent = [];
reply = { status: 201, body: { sid: 'SM125', status: 'queued' } };
const spaced = await boot('d', 4145, { NODE_ENV: '', ...TWILIO_ENV, TWILIO_FROM: '+1 605 315 3581' });
await register(spaced, '+77015558004');
check('a spaced number is normalised to E.164', (sent[0] || {}).params.From === '+16053153581', JSON.stringify((sent[0] || {}).params));

// An alphanumeric sender ID must survive untouched - stripping non-digits
// would destroy it.
sent = [];
const alpha = await boot('e', 4146, { NODE_ENV: '', ...TWILIO_ENV, TWILIO_FROM: 'DrivePro' });
await register(alpha, '+77015558005');
check('an alphanumeric sender is passed through as-is', (sent[0] || {}).params.From === 'DrivePro', JSON.stringify((sent[0] || {}).params));

// ------------------------------------------- explicit override still warns ---

const forced = await boot('f', 4147, { NODE_ENV: '', ...TWILIO_ENV, OTP_ECHO: '1' });
check('an explicit OTP_ECHO=1 still wins', /echo to clients ON|OTP_ECHO is ON/.test(forced.banner), forced.banner);
check(
  'but it warns that a real provider is configured',
  /!! OTP_ECHO is ON and a real SMS provider is configured/.test(forced.banner),
  forced.banner
);

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
