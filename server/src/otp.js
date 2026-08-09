import crypto from 'node:crypto';

// Phone verification codes. The delivery function is intentionally isolated:
// swap sendCode() for a real SMS provider (Twilio etc.) when going live.
//
// In mock mode the code is printed to the server console and echoed back to
// the client in dev responses so testing needs no real SMS.

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000;

export const IS_PROD = process.env.NODE_ENV === 'production';

// Echoing the code back to the caller lets anyone verify a phone number they
// do not own, so production defaults to OFF. An explicit OTP_ECHO wins either
// way (prod currently sets OTP_ECHO=1 because no SMS provider is wired yet -
// see deploy/DEPLOY.md).
export const OTP_ECHO =
  process.env.OTP_ECHO != null && process.env.OTP_ECHO !== ''
    ? process.env.OTP_ECHO !== '0'
    : !IS_PROD;

// One-line summary for the boot banner; loud when prod is echoing codes.
export function otpModeBanner() {
  const env = IS_PROD ? 'production' : process.env.NODE_ENV || 'development';
  if (IS_PROD && OTP_ECHO) {
    return `  !! OTP_ECHO is ON in ${env} - codes are returned to clients. Not safe for real users.`;
  }
  return `  OTP:     mock delivery (console), echo to clients ${OTP_ECHO ? 'ON' : 'OFF'} [${env}]`;
}

export function generateCode() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

export function sendCode(phone, code) {
  // Mock delivery. Replace with a real SMS API call for production.
  console.log(`[otp] verification code for ${phone}: ${code}`);
}
