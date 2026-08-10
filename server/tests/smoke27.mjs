// L26 smoke test: verifying a phone through Telegram instead of SMS.
//
// Kazakh carriers need a pre-registered sender ID for A2P SMS and refuse
// international long codes, so the bot is the channel that actually reaches
// users. It is also a stronger proof than an SMS code: Telegram reports the
// phone number it has already verified, and the account is only verified when
// that number matches the one typed into the app.
//
// The risks worth pinning are therefore about trust, not plumbing: a forwarded
// contact belonging to somebody else must not verify anything, a mismatched
// number must not verify anything, and an expired nonce must not hand out a
// session. TELEGRAM_API_URL points at a stub, so nothing reaches telegram.org.
// Usage: node tests/smoke27.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4150;
const TG_PORT = 4151;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, '.tmp-data27');
const BOT = 'DriveProTestBot';

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

// ---- stub Bot API ----
let pending = []; // updates waiting to be delivered by getUpdates
let outbox = []; // messages the bot sent
let updateId = 100;
const telegram = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    const method = req.url.split('/').pop();
    const body = raw ? JSON.parse(raw) : {};
    const reply = (result) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result }));
    };
    if (method === 'getMe') return reply({ id: 1, is_bot: true, username: BOT });
    if (method === 'sendMessage') {
      outbox.push(body);
      return reply({ message_id: outbox.length });
    }
    if (method === 'getUpdates') {
      // Emulate long polling: hold briefly when idle so the server does not
      // spin, and hand over everything queued otherwise.
      if (!pending.length) await new Promise((r) => setTimeout(r, 250));
      const batch = pending;
      pending = [];
      return reply(batch);
    }
    return reply({});
  });
});
await new Promise((r) => telegram.listen(TG_PORT, r));

const push = (message) => pending.push({ update_id: ++updateId, message });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Wait for the bot to have consumed the queue and replied.
const settle = async () => {
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    if (!pending.length) break;
  }
  await sleep(250);
};

fs.rmSync(DATA_DIR, { recursive: true, force: true });
const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR,
    TELEGRAM_BOT_TOKEN: 'fake:token',
    TELEGRAM_API_URL: `http://localhost:${TG_PORT}`,
    TELEGRAM_POLL_TIMEOUT_S: '1',
    // Registration stamps otpSentAt, and the reset below would otherwise sit
    // behind the 30s resend cooldown.
    DRIVEPRO_OTP_COOLDOWN_MS: '150',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
server.stdout.on('data', (d) => (bootLog += String(d)));
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start')), 8000);
  const iv = setInterval(() => {
    if (bootLog.includes('running')) {
      clearTimeout(t);
      clearInterval(iv);
      resolve();
    }
  }, 50);
});
const cleanup = () => {
  try {
    server.kill();
  } catch {}
  try {
    telegram.close();
  } catch {}
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
};
process.on('exit', cleanup);

async function api(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

// getMe resolves asynchronously after boot.
let health = null;
for (let i = 0; i < 40; i++) {
  health = (await api('GET', '/api/health')).json;
  if (health && health.telegram) break;
  await sleep(100);
}
check('health advertises Telegram once the bot is reachable', health && health.telegram === true, JSON.stringify(health));
// journalctl is the only diagnostic on the VM, so the log must state the
// outcome - not a "connecting…" line that never resolves.
check('the log states that the bot connected', /Telegram: bot @DriveProTestBot connected/.test(bootLog), bootLog.split('\n').filter((l) => l.includes('Telegram')).join(' | '));

const PHONE = '+77015560001';
const reg = await api('POST', '/api/register', { phone: PHONE, password: 'pass1234', name: 'Aigerim' });
check('registration succeeds', reg.status === 201, JSON.stringify(reg.json));
check('the app is told Telegram is an option', reg.json.telegram === true);

// ------------------------------------------------------------- the link ---

const link = await api('POST', '/api/telegram/link', { phone: PHONE });
check('a link request returns a nonce', link.status === 200 && typeof link.json.nonce === 'string', JSON.stringify(link.json));
check('the deep link points at the bot', link.json.url === `https://t.me/${BOT}?start=${link.json.nonce}`, link.json.url);
const nonce = link.json.nonce;

const before = await api('GET', `/api/telegram/link/${nonce}`);
check('it starts out pending', before.json.status === 'pending', JSON.stringify(before.json));

const CHAT = 55501;
const FROM = { id: 99001, is_bot: false, first_name: 'Aigerim' };
outbox = [];
push({ message_id: 1, chat: { id: CHAT }, from: FROM, text: `/start ${nonce}` });
await settle();

check('the bot asked for the contact', outbox.some((m) => m.reply_markup && JSON.stringify(m.reply_markup).includes('request_contact')), JSON.stringify(outbox));
const linked = await api('GET', `/api/telegram/link/${nonce}`);
check('the request is now linked', linked.json.status === 'linked', JSON.stringify(linked.json));
check('no session is handed out before the number is proven', linked.json.token === undefined);

// ---------------------------------------------------- somebody else's card ---

// Forwarding a friend's contact must prove nothing: Telegram only sets
// contact.user_id to the sender's own id when they share themselves.
outbox = [];
push({ message_id: 2, chat: { id: CHAT }, from: FROM, contact: { phone_number: PHONE, user_id: 12345, first_name: 'Someone' } });
await settle();
const forwarded = await api('GET', `/api/telegram/link/${nonce}`);
check('a forwarded contact does not verify', forwarded.json.status === 'linked', JSON.stringify(forwarded.json));
check('and the bot says why', outbox.some((m) => /собственным контактом/.test(m.text || '')), JSON.stringify(outbox));

// ---------------------------------------------------------- wrong number ---

outbox = [];
push({ message_id: 3, chat: { id: CHAT }, from: FROM, contact: { phone_number: '+77019998877', user_id: FROM.id, first_name: 'Aigerim' } });
await settle();
const wrong = await api('GET', `/api/telegram/link/${nonce}`);
check('a different number does not verify the account', wrong.json.status === 'mismatch', JSON.stringify(wrong.json));

// ------------------------------------------------------------ the real one ---

// Telegram sends the number without a '+', which must still match.
outbox = [];
push({ message_id: 4, chat: { id: CHAT }, from: FROM, contact: { phone_number: '77015560001', user_id: FROM.id, first_name: 'Aigerim' } });
await settle();
const done = await api('GET', `/api/telegram/link/${nonce}`);
check('sharing your own matching contact verifies the account', done.json.status === 'verified', JSON.stringify(done.json));
check('a session comes back with it', typeof done.json.token === 'string' && done.json.user && done.json.user.name === 'Aigerim');
// The whole point of the contact flow: no verification code is generated,
// sent or entered anywhere in it.
check('verification involved no code at all', !outbox.some((m) => /\d{4}/.test(m.text || '')), JSON.stringify(outbox));

// The account is genuinely verified: logging in must not ask again.
const login = await api('POST', '/api/login', { phone: PHONE, password: 'pass1234' });
check('login no longer needs verification', login.status === 200 && !!login.json.token, JSON.stringify(login.json));

// ----------------------------------------------------------- bad nonces ---

const unknown = await api('GET', '/api/telegram/link/not-a-real-nonce');
check('an unknown nonce 404s', unknown.status === 404 && unknown.json.code === 'link_expired', String(unknown.status));

outbox = [];
push({ message_id: 5, chat: { id: 55502 }, from: { id: 99002 }, text: '/start deadbeefdeadbeef' });
await settle();
check('an expired deep link is told so', outbox.some((m) => /устарела/.test(m.text || '')), JSON.stringify(outbox));

const noAccount = await api('POST', '/api/telegram/link', { phone: '+77019990000' });
check('linking an unknown phone 404s', noAccount.status === 404 && noAccount.json.code === 'no_account');

// ------------------------------------------- codes now go through the bot ---

// With a chat linked, a later code (password reset, say) must reach Telegram
// rather than an SMS route that cannot deliver to Kazakhstan.
outbox = [];
await sleep(250); // let the resend cooldown lapse
const reset = await api('POST', '/api/reset/request', { phone: PHONE });
check('a reset request succeeds', reset.status === 200, JSON.stringify(reset.json));
check('the code went to the Telegram chat', outbox.some((m) => String(m.chat_id) === String(CHAT) && /\d{4}/.test(m.text || '')), JSON.stringify(outbox));

console.log(`\n${passed} passed, ${failed} failed`);
cleanup();
process.exit(failed ? 1 : 0);
