// L66: production OTP delivery and verified-account session boundary.
// All provider traffic stays on local stubs with synthetic accounts.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const index = path.join(here, '..', 'src', 'index.js');
const dataRoot = path.join(here, `.tmp-data66-${process.pid}`);
const appPorts = [4266, 4269, 4270, 4271, 4272];
const smsPort = 4267;
const telegramPort = 4268;
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
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const messages = [];
let smsReply = { status: 201, body: { sid: 'SMstub' } };
const sms = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    messages.push(Object.fromEntries(new URLSearchParams(body)));
    res.writeHead(smsReply.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(smsReply.body));
  });
});
const telegram = http.createServer((req, res) => {
  const method = req.url.split('/').at(-1);
  const reply = () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: method === 'getMe' ? { username: 'stub_bot' } : [] }));
  };
  if (method === 'getUpdates') setTimeout(reply, 200);
  else reply();
});
const listen = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});
const close = (server) => new Promise((resolve) => {
  if (!server.listening) return resolve();
  server.close(resolve);
});
const running = [];
async function stop(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  proc.kill('SIGTERM');
  await Promise.race([exited, delay(1000)]);
  if (proc.exitCode === null && proc.signalCode === null) {
    proc.kill('SIGKILL');
    await Promise.race([exited, delay(1000)]);
  }
}

async function boot(tag, port, env) {
  const dir = path.join(dataRoot, tag);
  fs.mkdirSync(dir, { recursive: true });
  const proc = spawn(process.execPath, [index], {
    env: {
      ...process.env,
      PORT: String(port), DATA_DIR: dir, NODE_ENV: 'production', OTP_ECHO: '1',
      TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_FROM: '',
      TWILIO_MESSAGING_SERVICE_SID: '', TELEGRAM_BOT_TOKEN: '',
      DRIVEPRO_OTP_COOLDOWN_MS: '1', SMS_TEMPLATE: 'SENSITIVE_OTP_BODY_{code}',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  proc.stdout.on('data', (chunk) => { output += String(chunk); });
  proc.stderr.on('data', (chunk) => { output += String(chunk); });
  running.push(proc);
  for (let attempt = 0; attempt < 60; attempt++) {
    if (proc.exitCode !== null) break;
    if (!output.includes('DrivePro server running')) {
      await delay(100);
      continue;
    }
    try {
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (health.ok) return {
        logs: () => output,
        api: async (route, body) => {
          const response = await fetch(`http://127.0.0.1:${port}${route}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          return { status: response.status, json: await response.json() };
        },
      };
    } catch {}
    await delay(100);
  }
  throw new Error(`L66 ${tag} server did not start`);
}

const register = (server, phone) => server.api('/api/register', {
  phone, password: 'pass1234', name: 'Aigerim',
});
const hasNoCode = (response) => response.json.devCode === undefined && !response.json.token;
const codeFromLastMessage = () => (messages.at(-1)?.Body || '').match(/(\d{4})(?!\d)/)?.[1];
const denied = (response) => response.status === 400
  && response.json.code === 'already_verified' && !response.json.token;

try {
  await listen(sms, smsPort);
  await listen(telegram, telegramPort);
  const provider = await boot('provider', appPorts[0], {
    TWILIO_ACCOUNT_SID: 'ACfake0000000000000000000000000000',
    TWILIO_AUTH_TOKEN: 'fake-token', TWILIO_FROM: '+15550001111',
    TWILIO_API_URL: `http://127.0.0.1:${smsPort}`,
  });
  check('production override still reports echo OFF', /echo to clients OFF/.test(provider.logs()));
  const first = await register(provider, '+15556660001');
  check('production registration uses stub delivery without devCode',
    first.status === 201 && hasNoCode(first) && messages.length === 1);
  const code = codeFromLastMessage();
  check('stub received a four-digit verification code', /^\d{4}$/.test(code || ''));
  const wrong = code === '0000' ? '1111' : '0000';
  const wrongVerify = await provider.api('/api/verify', { phone: '+15556660001', code: wrong });
  check('incorrect initial proof cannot issue a token', wrongVerify.status === 400 && !wrongVerify.json.token);
  const verified = await provider.api('/api/verify', { phone: '+15556660001', code });
  check('valid initial proof issues a session', verified.status === 200 && !!verified.json.token);
  for (const [label, candidate] of [['empty', ''], ['arbitrary', wrong], ['replayed', code]]) {
    const result = await provider.api('/api/verify', { phone: '+15556660001', code: candidate });
    check(`${label} code cannot issue a second session`, denied(result));
  }
  const login = await provider.api('/api/login', { phone: '+15556660001', password: 'pass1234' });
  check('normal password login still issues a session', login.status === 200 && !!login.json.token);

  const pending = await register(provider, '+15556660002');
  check('second registration has no devCode', pending.status === 201 && hasNoCode(pending));
  const pendingLogin = await provider.api('/api/login', { phone: '+15556660002', password: 'pass1234' });
  check('unverified login has no devCode or token', pendingLogin.status === 403 && hasNoCode(pendingLogin));
  await delay(10);
  const resent = await provider.api('/api/resend', { phone: '+15556660002' });
  check('production resend has no devCode or token', resent.status === 200 && hasNoCode(resent));
  await delay(10);
  const reset = await provider.api('/api/reset/request', { phone: '+15556660001' });
  check('production reset request has no devCode or token', reset.status === 200 && hasNoCode(reset));

  const noProvider = await boot('missing', appPorts[1]);
  check('missing provider is reported as unavailable', /SMS:\s+unconfigured/.test(noProvider.logs()));
  const missingReg = await register(noProvider, '+15556660003');
  check('missing provider fails registration cleanly',
    missingReg.status === 502 && missingReg.json.code === 'sms_failed' && hasNoCode(missingReg));
  const missingLogin = await noProvider.api('/api/login', { phone: '+15556660003', password: 'pass1234' });
  const missingResend = await noProvider.api('/api/resend', { phone: '+15556660003' });
  const missingReset = await noProvider.api('/api/reset/request', { phone: '+15556660003' });
  check('missing provider fails login, resend and reset delivery cleanly',
    [missingLogin, missingResend, missingReset].every((result) =>
      result.status === 502 && result.json.code === 'sms_failed' && hasNoCode(result)));
  await delay(10);
  check('missing provider never logs a mock OTP or message body',
    !noProvider.logs().includes('[sms] (mock)') && !noProvider.logs().includes('SENSITIVE_OTP_BODY'));

  const partial = await boot('partial', appPorts[2], { TWILIO_ACCOUNT_SID: 'ACpartial' });
  const partialReg = await register(partial, '+15556660004');
  check('partial SMS settings also fail without mock delivery',
    partialReg.status === 502 && partialReg.json.code === 'sms_failed'
      && hasNoCode(partialReg) && !partial.logs().includes('SENSITIVE_OTP_BODY'));

  smsReply = { status: 400, body: { code: 21608, message: 'SENSITIVE_PROVIDER_MESSAGE' } };
  const refused = await register(provider, '+15556660005');
  check('provider refusal has no devCode or token',
    refused.status === 502 && refused.json.code === 'sms_failed' && hasNoCode(refused));
  await delay(10);
  check('production logs omit provider text, message body and mock codes',
    !provider.logs().includes('SENSITIVE_PROVIDER_MESSAGE')
      && !provider.logs().includes('SENSITIVE_OTP_BODY')
      && !provider.logs().includes('[sms] (mock)'));

  const fallback = await boot('telegram', appPorts[3], {
    TELEGRAM_BOT_TOKEN: 'fake-bot-token', TELEGRAM_API_URL: `http://127.0.0.1:${telegramPort}`,
    TELEGRAM_POLL_TIMEOUT_S: '1',
  });
  for (let attempt = 0; attempt < 30 && !fallback.logs().includes('bot @stub_bot connected'); attempt++) {
    await delay(100);
  }
  const telegramReg = await register(fallback, '+15556660006');
  check('connected Telegram keeps pending registration available without SMS',
    telegramReg.status === 201 && telegramReg.json.telegram === true && hasNoCode(telegramReg));
  check('Telegram fallback does not print the undelivered SMS body',
    !fallback.logs().includes('SENSITIVE_OTP_BODY'));

  const dev = await boot('dev', appPorts[4], { NODE_ENV: 'test', OTP_ECHO: '' });
  const devReg = await register(dev, '+15556660007');
  check('test mock still returns the local verification code',
    devReg.status === 201 && /^\d{4}$/.test(devReg.json.devCode || ''));
  const devVerified = await dev.api('/api/verify', { phone: '+15556660007', code: devReg.json.devCode });
  check('local mock code still verifies normally', devVerified.status === 200 && !!devVerified.json.token);
} finally {
  for (const proc of running) await stop(proc);
  await close(sms);
  await close(telegram);
  fs.rmSync(dataRoot, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
