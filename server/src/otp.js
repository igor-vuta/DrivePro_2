import crypto from 'node:crypto';
import { sendSms, verificationText, smsConfigured, smsProvider } from './sms.js';
import { telegramConfigured, sendTelegramMessage } from './telegram.js';

// Phone verification codes. Delivery lives in sms.js; the mock provider is
// available only outside production.

export const OTP_TTL_MS = 10 * 60 * 1000;
// Overridable so tests can drive the resend/reset flow without waiting 30s,
// the same seam DRIVEPRO_SCHED_SWEEP_MS gives the schedule sweeper.
export const OTP_RESEND_COOLDOWN_MS = Number(process.env.DRIVEPRO_OTP_COOLDOWN_MS || 30 * 1000);

export const IS_PROD = process.env.NODE_ENV === 'production';

// Echoing the code back to the caller lets anyone verify a phone number they
// do not own. It exists only because a mock provider has no other way to
// deliver locally. Production never echoes, including with a legacy override.
export const OTP_ECHO = !IS_PROD && (
  process.env.OTP_ECHO != null && process.env.OTP_ECHO !== ''
    ? process.env.OTP_ECHO !== '0'
    : !smsConfigured()
);

// One-line summary for the boot banner; a dev override with real SMS warns.
export function otpModeBanner() {
  const env = IS_PROD ? 'production' : process.env.NODE_ENV || 'development';
  if (OTP_ECHO && smsConfigured()) {
    return '  !! OTP_ECHO is ON and a real SMS provider is configured - codes are returned to clients. Not safe for real users.';
  }
  return `  OTP:     delivery ${smsProvider()}, echo to clients ${OTP_ECHO ? 'ON' : 'OFF'} [${env}]`;
}

export function generateCode() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

// Delivers to whichever channel this user actually has. A linked Telegram
// chat wins over SMS: it is free, instant, and reaches Kazakh numbers that
// an international long code cannot.
//
// Throws if the chosen provider refuses, so the caller can tell the user
// instead of leaving them waiting for a code that is never coming.
// Unconfigured production SMS throws instead of using the local mock.
export async function sendCode(user, code) {
  if (telegramConfigured() && user && user.telegramChatId) {
    await sendTelegramMessage(user.telegramChatId, verificationText(code));
    return 'telegram';
  }
  await sendSms(user && user.phone ? user.phone : user, verificationText(code));
  return smsProvider();
}
