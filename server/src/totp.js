import crypto from 'node:crypto';

// Time-based one-time passwords (RFC 6238 over RFC 4226 HOTP), so any
// authenticator app works: Google Authenticator, Aegis, 1Password, Yubico.
//
// Zero dependencies - it is an HMAC over a counter and a truncation, both of
// which node:crypto already does. Kept free of the store and the API so the
// maths can be tested against the RFC's own vectors.
//
// This is a convenience for fast login, never an identity check: the verified
// phone remains the account's identity and its recovery path.

export const TOTP_STEP_S = 30;
export const TOTP_DIGITS = 6;
// One step either side, so a phone clock that is slightly off still works.
export const TOTP_WINDOW = 1;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// 20 bytes = 160 bits, the size RFC 4226 recommends for HMAC-SHA1.
export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

// RFC 4226 §5.3: HMAC, then dynamic truncation on the low nibble offset.
export function hotp(secretBuf, counter, digits = TOTP_DIGITS) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const mac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) | ((mac[offset + 1] & 0xff) << 16) | ((mac[offset + 2] & 0xff) << 8) | (mac[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totp(secretB32, atMs = Date.now(), digits = TOTP_DIGITS) {
  return hotp(base32Decode(secretB32), Math.floor(atMs / 1000 / TOTP_STEP_S), digits);
}

// True if `code` is valid now or within TOTP_WINDOW steps either side.
// Comparison is constant-time so a wrong code leaks nothing by timing.
export function verifyTotp(secretB32, code, atMs = Date.now(), window = TOTP_WINDOW) {
  const clean = String(code || '').replace(/\D/g, '');
  if (clean.length !== TOTP_DIGITS) return false;
  const key = base32Decode(secretB32);
  if (!key.length) return false;
  const step = Math.floor(atMs / 1000 / TOTP_STEP_S);
  const given = Buffer.from(clean);
  let ok = false;
  for (let i = -window; i <= window; i++) {
    const expected = Buffer.from(hotp(key, step + i));
    // Keep going after a match so the loop always costs the same.
    if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) ok = true;
  }
  return ok;
}

// The string an authenticator app expects, per Key Uri Format. Shown as text
// for manual entry as well as encoded into the QR.
export function otpauthUrl({ secret, account, issuer = 'DrivePro' }) {
  // Key Uri Format keeps the colon literal and encodes the two parts around
  // it; encoding the colon too makes some authenticators show the whole thing
  // as one account name.
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_S),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
