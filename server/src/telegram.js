import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normPhone } from './util.js';

// Telegram delivery. Zero dependencies: the Bot API is JSON over HTTPS.
//
//   TELEGRAM_BOT_TOKEN   from @BotFather - the only thing you need
//   TELEGRAM_API_URL     overridable so tests never touch telegram.org
//
// Why this exists beside Twilio: Kazakh carriers require a pre-registered
// alphanumeric sender ID for A2P SMS, which needs company paperwork and days
// of waiting, and international long codes are refused outright. A bot needs
// no approval from anyone and reaches the same people.
//
// Updates arrive by long polling rather than a webhook, so this works in
// local development with no public URL and needs nothing in the Caddyfile.

const API = process.env.TELEGRAM_API_URL || 'https://api.telegram.org';
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const LINK_TTL_MS = 15 * 60 * 1000;
const POLL_TIMEOUT_S = Number(process.env.TELEGRAM_POLL_TIMEOUT_S || 25);

export const telegramConfigured = () => Boolean(TOKEN);

let botUsername = null;
export const telegramBotUsername = () => botUsername;

// Only meaningful once getMe has answered. initTelegram logs the outcome
// itself, because it resolves after the boot banner has already printed and
// a line saying "connecting…" forever is worse than no line at all.
export function telegramBanner() {
  return botUsername ? `  Telegram: bot @${botUsername}` : null;
}

async function call(method, payload, timeoutMs = 10_000) {
  const res = await fetch(`${API}/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => null);
  if (!json || json.ok !== true) {
    const why = (json && json.description) || `HTTP ${res.status}`;
    throw new Error(`telegram ${method} failed: ${why}`);
  }
  return json.result;
}

export function sendTelegramMessage(chatId, text, extra) {
  return call('sendMessage', { chat_id: chatId, text, ...extra });
}

// --------------------------------------------------------- link requests ---
//
// A link request is the bridge between "someone is signing up in the browser"
// and "someone pressed Start in Telegram". The nonce travels through the deep
// link, so the bot can tell which pending signup a chat belongs to. Held in
// memory on purpose: they live for minutes, and losing them on restart just
// means the user taps the button again.

const links = new Map(); // nonce -> { userId, phone, status, chatId, at }

function sweepLinks(now = Date.now()) {
  for (const [nonce, rec] of links) if (now - rec.at > LINK_TTL_MS) links.delete(nonce);
}

export function createLinkRequest(user) {
  sweepLinks();
  const nonce = crypto.randomBytes(9).toString('base64url');
  links.set(nonce, { userId: user.id, phone: user.phone, status: 'pending', chatId: null, at: Date.now() });
  return nonce;
}

export function readLinkRequest(nonce) {
  sweepLinks();
  return links.get(nonce) || null;
}

export function deepLink(nonce) {
  return botUsername ? `https://t.me/${botUsername}?start=${nonce}` : null;
}

// Telegram hands back the phone with or without a '+', and sometimes with
// separators, so compare the digits alone.
const digits = (s) => String(s || '').replace(/\D/g, '');
const samePhone = (a, b) => digits(a).length > 6 && digits(a) === digits(b);

// ------------------------------------------------------------- the bot ---

const TEXT = {
  askContact:
    'DrivePro: чтобы подтвердить номер, нажмите кнопку ниже — Telegram сам передаст ваш номер телефона.',
  wrongNumber:
    'Этот номер не совпадает с тем, который вы указали в DrivePro. Начните регистрацию заново с этим номером.',
  notOwnContact: 'Нужно поделиться своим собственным контактом.',
  verified: 'Номер подтверждён. Можно возвращаться в DrivePro.',
  expired: 'Ссылка устарела. Откройте DrivePro и попробуйте ещё раз.',
  linked: 'Готово! Коды подтверждения теперь будут приходить сюда.',
};

const contactKeyboard = {
  keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

// Handles one update. Exported so tests can drive the bot deterministically
// instead of waiting on the polling loop.
export async function handleUpdate(store, update) {
  const msg = update && update.message;
  if (!msg || !msg.chat) return null;
  const chatId = msg.chat.id;

  // "/start <nonce>" - the deep link the app opened.
  const startMatch = typeof msg.text === 'string' && msg.text.match(/^\/start\s+(\S+)/);
  if (startMatch) {
    const rec = readLinkRequest(startMatch[1]);
    if (!rec) {
      await sendTelegramMessage(chatId, TEXT.expired);
      return { action: 'expired' };
    }
    rec.chatId = chatId;
    rec.status = 'linked';
    // Bind the chat now so codes can be delivered here even if the user never
    // shares a contact; verification is a separate, stronger step.
    store.updateUser(rec.userId, { telegramChatId: String(chatId) });
    await sendTelegramMessage(chatId, TEXT.askContact, { reply_markup: contactKeyboard });
    return { action: 'linked', userId: rec.userId };
  }

  if (msg.contact) {
    // A user can forward anyone's contact card; only their own proves the
    // number is theirs, and Telegram marks that with a matching user_id.
    if (!msg.from || msg.contact.user_id !== msg.from.id) {
      await sendTelegramMessage(chatId, TEXT.notOwnContact);
      return { action: 'not_own_contact' };
    }
    const rec = [...links.values()].find((r) => String(r.chatId) === String(chatId));
    if (!rec) {
      await sendTelegramMessage(chatId, TEXT.expired);
      return { action: 'expired' };
    }
    if (!samePhone(msg.contact.phone_number, rec.phone)) {
      rec.status = 'mismatch';
      await sendTelegramMessage(chatId, TEXT.wrongNumber, { reply_markup: { remove_keyboard: true } });
      return { action: 'mismatch' };
    }
    // Telegram vouches for this number, which is exactly what the SMS code
    // was for - so the account is verified without any code at all.
    rec.status = 'verified';
    store.updateUser(rec.userId, { verified: true, telegramChatId: String(chatId), otpCode: null, otpExpires: null, otpAttempts: 0 });
    await sendTelegramMessage(chatId, TEXT.verified, { reply_markup: { remove_keyboard: true } });
    return { action: 'verified', userId: rec.userId };
  }

  if (typeof msg.text === 'string' && msg.text.startsWith('/start')) {
    await sendTelegramMessage(chatId, TEXT.linked);
    return { action: 'bare_start' };
  }
  return null;
}

// ------------------------------------------------------------- polling ---

let offset = 0;
let offsetFile = null;
let stopped = false;

function saveOffset() {
  if (!offsetFile) return;
  try {
    fs.writeFileSync(offsetFile, JSON.stringify({ offset }), { mode: 0o600 });
  } catch {}
}

// One getUpdates cycle. Returns how many updates were handled.
export async function pollOnce(store) {
  const updates = await call('getUpdates', { offset, timeout: POLL_TIMEOUT_S }, (POLL_TIMEOUT_S + 10) * 1000);
  let handled = 0;
  for (const u of updates || []) {
    offset = Math.max(offset, u.update_id + 1);
    try {
      await handleUpdate(store, u);
      handled++;
    } catch (e) {
      console.error('[telegram] update failed:', e.message);
    }
  }
  if (handled) saveOffset();
  return handled;
}

export async function initTelegram({ store, dataDir }) {
  if (!telegramConfigured()) return false;
  offsetFile = path.join(dataDir, 'telegram.json');
  try {
    offset = JSON.parse(fs.readFileSync(offsetFile, 'utf8')).offset || 0;
  } catch {}
  try {
    const me = await call('getMe', {});
    botUsername = me.username;
    console.log(`  Telegram: bot @${botUsername} connected`);
  } catch (e) {
    console.error('  Telegram: NOT connected -', e.message);
    return false;
  }
  // Long-poll forever; a failure just backs off and retries, because a bot
  // outage must not take the rest of the server down.
  (async () => {
    while (!stopped) {
      try {
        await pollOnce(store);
      } catch (e) {
        if (!stopped) console.error('[telegram] poll failed:', e.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();
  return true;
}

export function stopTelegram() {
  stopped = true;
}
