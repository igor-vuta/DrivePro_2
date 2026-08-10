// SMS delivery. Zero dependencies: Twilio's REST API is a form-encoded POST
// with HTTP Basic auth, which fetch and node:crypto's Buffer cover.
//
// Credentials come from the environment and are never logged:
//   TWILIO_ACCOUNT_SID   ACxxxxxxxx…
//   TWILIO_AUTH_TOKEN    (secret)
//   TWILIO_FROM          +1234567890            - a number you own, or
//   TWILIO_MESSAGING_SERVICE_SID  MGxxxxxxxx…   - a Messaging Service
//
// With none of them set the provider is `mock`: the code is printed to the
// server log and (in dev) echoed to the client, exactly as before. That keeps
// local development and the whole test suite free of external calls.

const API_BASE = process.env.TWILIO_API_URL || 'https://api.twilio.com';
const SID = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TOKEN = (process.env.TWILIO_AUTH_TOKEN || '').trim();
// Twilio wants E.164 (+16053153581), but the console displays numbers spaced
// out ("+1 605 315 3581") and that is what gets pasted into the env file - a
// rejected `From` is a confusing way to find that out. Strip the separators
// from anything starting with '+'. An alphanumeric sender ID ("DrivePro") has
// no leading + and is passed through exactly as configured.
const rawFrom = (process.env.TWILIO_FROM || '').trim();
const FROM = rawFrom.startsWith('+') ? `+${rawFrom.slice(1).replace(/\D/g, '')}` : rawFrom;
const SERVICE_SID = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim();

// Server-side strings stay Russian for now, like the push notifications.
const TEMPLATE = process.env.SMS_TEMPLATE || 'DrivePro: код подтверждения {code}';

export const smsConfigured = () => Boolean(SID && TOKEN && (FROM || SERVICE_SID));
export const smsProvider = () => (smsConfigured() ? 'twilio' : 'mock');

// Describes the provider without revealing anything secret - the account SID
// is truncated because it identifies the account.
export function smsBanner() {
  if (!smsConfigured()) return '  SMS:     mock (codes go to this log only)';
  const via = SERVICE_SID ? `service ${SERVICE_SID.slice(0, 6)}…` : `from ${FROM}`;
  return `  SMS:     twilio ${SID.slice(0, 6)}… ${via}`;
}

export class SmsError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.providerCode = code;
  }
}

// Resolves when the provider has accepted the message for delivery. Throws
// SmsError otherwise - the caller decides whether that fails the request.
export async function sendSms(to, body) {
  if (!smsConfigured()) {
    console.log(`[sms] (mock) to ${to}: ${body}`);
    return { provider: 'mock', sid: null };
  }
  const form = new URLSearchParams({ To: to, Body: body });
  if (SERVICE_SID) form.set('MessagingServiceSid', SERVICE_SID);
  else form.set('From', FROM);

  let res;
  try {
    res = await fetch(`${API_BASE}/2010-04-01/Accounts/${encodeURIComponent(SID)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new SmsError(`twilio unreachable: ${e.message}`, 0, null);
  }

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}

  if (!res.ok) {
    // Twilio's own error code is the useful part; 21608 = unverified number on
    // a trial account, 21211 = malformed To, 21610 = recipient unsubscribed.
    const code = json && json.code ? json.code : null;
    const msg = (json && json.message) || `HTTP ${res.status}`;
    throw new SmsError(`twilio rejected the message: ${msg}`, res.status, code);
  }
  return { provider: 'twilio', sid: json && json.sid ? json.sid : null };
}

export function verificationText(code) {
  return TEMPLATE.replace('{code}', code);
}
