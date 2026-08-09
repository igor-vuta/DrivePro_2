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

export const PASSWORD_MIN = 8;

// Password rules, shared by registration and password reset. Returns a
// `snake_code` (which has a matching err.<code> string in both languages) or
// null when the password is acceptable. Login is deliberately NOT checked:
// accounts created under the old 6-character rule keep working.
export function passwordProblem(password, phone) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return 'password_short';
  // \p{L} so Cyrillic and Kazakh letters count just like Latin ones.
  if (!/\p{L}/u.test(password) || !/[0-9]/.test(password)) return 'password_weak';
  const phoneDigits = String(phone || '').replace(/\D/g, '');
  if (phoneDigits.length >= 7) {
    const pwDigits = password.replace(/\D/g, '');
    // The whole number, or the memorable tail of it, must not be the password.
    if (pwDigits.includes(phoneDigits) || pwDigits.includes(phoneDigits.slice(-7))) return 'password_has_phone';
  }
  return null;
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

// Distance (meters) from a point to a polyline of [lat, lng] pairs, plus the
// fractional position (segment index + t) of the nearest projection - used to
// check travel direction along a driver's route. Equirectangular approximation,
// accurate enough at city scale.
export function pointToPolyline(lat, lng, pts) {
  if (!Array.isArray(pts) || pts.length < 2) return { distM: Infinity, pos: -1 };
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const X = (p) => p[1] * cosLat * 111_320;
  const Y = (p) => p[0] * 110_540;
  const px = X([lat, lng]);
  const py = Y([lat, lng]);
  let best = Infinity;
  let bestPos = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = X(pts[i]);
    const ay = Y(pts[i]);
    const bx = X(pts[i + 1]);
    const by = Y(pts[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) {
      best = d;
      bestPos = i + t;
    }
  }
  return { distM: best, pos: bestPos };
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
