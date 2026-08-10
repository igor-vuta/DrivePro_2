import crypto from 'node:crypto';
import { sendSms, verificationText, smsConfigured, smsProvider } from './sms.js';

// Phone verification codes. Delivery lives in sms.js; with no provider
// configured it degrades to a mock that prints the code to the server log.

export const OTP_TTL_MS = 10 * 60 * 1000;
// Overridable so tests can drive the resend/reset flow without waiting 30s,
// the same seam DRIVEPRO_SCHED_SWEEP_MS gives the schedule sweeper.
export const OTP_RESEND_COOLDOWN_MS = Number(process.env.DRIVEPRO_OTP_COOLDOWN_MS || 30 * 1000);

export const IS_PROD = process.env.NODE_ENV === 'production';

// Echoing the code back to the caller lets anyone verify a phone number they
// do not own. It exists only because a mock provider has no other way to
// deliver, so it defaults OFF both in production and wherever a real SMS
// provider is configured. An explicit OTP_ECHO still wins - and says so
// loudly at boot, because doing that on a live deployment is a hole.
export const OTP_ECHO =
  process.env.OTP_ECHO != null && process.env.OTP_ECHO !== ''
    ? process.env.OTP_ECHO !== '0'
    : !IS_PROD && !smsConfigured();

// One-line summary for the boot banner; loud when codes are being echoed
// somewhere they should not be.
export function otpModeBanner() {
  const env = IS_PROD ? 'production' : process.env.NODE_ENV || 'development';
  if (OTP_ECHO && (IS_PROD || smsConfigured())) {
    const why = smsConfigured() ? 'a real SMS provider is configured' : `this is ${env}`;
    return `  !! OTP_ECHO is ON and ${why} - codes are returned to clients. Not safe for real users.`;
  }
  return `  OTP:     delivery ${smsProvider()}, echo to clients ${OTP_ECHO ? 'ON' : 'OFF'} [${env}]`;
}

export function generateCode() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

// Throws SmsError if a configured provider refuses the message, so the caller
// can tell the user instead of leaving them waiting for a code that is never
// coming. The mock provider never throws.
export async function sendCode(phone, code) {
  await sendSms(phone, verificationText(code));
}
