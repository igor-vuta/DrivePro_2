import crypto from 'node:crypto';

export const id = () => crypto.randomUUID();
export const now = () => Date.now();

export function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const onData = (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        req.removeListener('data', onData);
        req.resume(); // drain the rest so a clean HTTP response can go out
        reject(httpError(413, 'Request body is too large.', 'body_too_large'));
        return;
      }
      chunks.push(c);
    };
    req.on('data', onData);
    req.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks));
    });
    req.on('error', (e) => {
      if (!done) reject(e);
    });
  });
}

export async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { status: 400 });
  }
}

export function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  res.end(body);
}

export function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

// Phone normalization: keep leading + and digits only.
export function normPhone(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  const plus = s.startsWith('+') ? '+' : '';
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return plus + digits;
}

export function cleanStr(v, max = 200) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

export function isFiniteNum(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

export function isLat(n) {
  return isFiniteNum(n) && n >= -90 && n <= 90;
}

export function isLng(n) {
  return isFiniteNum(n) && n >= -180 && n <= 180;
}

export function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

// Address detail block: { entrance, apartment, floor, intercom, note } - all
// optional short strings. Returns a cleaned object or null if empty/absent.
export function cleanAddressDetails(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const key of ['entrance', 'apartment', 'floor', 'intercom']) {
    const v = cleanStr(raw[key], 20);
    if (v) out[key] = v;
  }
  const note = cleanStr(raw.note, 200);
  if (note) out.note = note;
  return Object.keys(out).length ? out : null;
}

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
