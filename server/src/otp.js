import crypto from 'node:crypto';

// Phone verification codes. The delivery function is intentionally isolated:
// swap sendCode() for a real SMS provider (Twilio etc.) when going live.
//
// In mock mode (default) the code is printed to the server console and echoed
// back to the client in dev responses so testing needs no real SMS.

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000;

// Set OTP_ECHO=0 in the environment to stop echoing codes to clients.
export const OTP_ECHO = process.env.OTP_ECHO !== '0';

export function generateCode() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

export function sendCode(phone, code) {
  // Mock delivery. Replace with a real SMS API call for production.
  console.log(`[otp] verification code for ${phone}: ${code}`);
}
