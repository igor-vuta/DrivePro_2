import { readJson, sendJson, httpError, normPhone, cleanStr, isLat, isLng, isValidEmail } from './util.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js';
import { publicUser, rideCounterpart, directoryUser } from './views.js';
import { reverseGeocode, searchAddress, route as geoRoute } from './geo.js';
import { generateCode, sendCode, OTP_TTL_MS, OTP_RESEND_COOLDOWN_MS, OTP_ECHO } from './otp.js';

const MAX_AVATAR_CHARS = 400_000; // ~300 KB of base64 image data

// REST API. Routes are matched as `${METHOD} ${pattern}`; `:param` segments
// are captured into params.

export function createApi({ store, secret, hub, serveStatic }) {
  const routes = [];

  const route = (method, pattern, handler) => {
    const keys = [];
    const regex = new RegExp(
      '^' +
        pattern
          .split('/')
          .map((seg) => {
            if (seg.startsWith(':')) {
              keys.push(seg.slice(1));
              return '([^/]+)';
            }
            return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('/') +
        '$'
    );
    routes.push({ method, regex, keys, handler });
  };

  const authUser = (req) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token ? verifyToken(token, secret) : null;
    const user = payload ? store.getUser(payload.uid) : null;
    if (!user) throw httpError(401, 'authentication required');
    return user;
  };

  const sessionPayload = (user) => ({
    token: signToken({ uid: user.id }, secret),
    user: publicUser(store, user.id),
  });

  // ----------------------------------------------------------- routes ---

  route('GET', '/api/health', async (req, res) => {
    sendJson(res, 200, { ok: true, name: 'DrivePro', storage: store.backendName, time: Date.now() });
  });

  const issueOtp = (user) => {
    const code = generateCode();
    store.updateUser(user.id, { otpCode: code, otpExpires: Date.now() + OTP_TTL_MS, otpSentAt: Date.now() });
    sendCode(user.phone, code);
    return code;
  };

  const verificationResponse = (res, status, user, code) => {
    sendJson(res, status, {
      needsVerification: true,
      phone: user.phone,
      // Mock-OTP convenience for development; disable with OTP_ECHO=0.
      ...(OTP_ECHO ? { devCode: code } : {}),
    });
  };

  route('POST', '/api/register', async (req, res) => {
    const body = await readJson(req);
    const phone = normPhone(body.phone);
    const name = cleanStr(body.name, 60);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!phone) throw httpError(400, 'Enter a valid phone number.', 'invalid_phone');
    if (name.length < 2) throw httpError(400, 'Enter your name.', 'name_required');
    if (password.length < 6) throw httpError(400, 'Password must be at least 6 characters.', 'password_short');
    const existing = store.findUserByPhone(phone);
    if (existing && existing.verified) throw httpError(409, 'This phone number is already registered.', 'phone_taken');
    let user;
    if (existing) {
      // Unverified leftover from an earlier attempt: refresh credentials.
      store.updateUser(existing.id, { name });
      user = existing;
    } else {
      user = store.createUser({ phone, passwordHash: hashPassword(password), name, verified: false });
    }
    const code = issueOtp(user);
    verificationResponse(res, 201, user, code);
  });

  route('POST', '/api/verify', async (req, res) => {
    const body = await readJson(req);
    const phone = normPhone(body.phone);
    const code = cleanStr(body.code, 8);
    const user = phone ? store.findUserByPhone(phone) : null;
    if (!user) throw httpError(404, 'No account with this phone number.', 'no_account');
    if (user.verified) {
      sendJson(res, 200, sessionPayload(user));
      return;
    }
    if (!user.otpCode || !user.otpExpires || user.otpExpires < Date.now()) {
      throw httpError(400, 'The code has expired. Request a new one.', 'code_expired');
    }
    if (user.otpCode !== code) throw httpError(400, 'Wrong code. Check and try again.', 'code_wrong');
    store.updateUser(user.id, { verified: true, otpCode: null, otpExpires: null });
    sendJson(res, 200, sessionPayload(store.getUser(user.id)));
  });

  route('POST', '/api/resend', async (req, res) => {
    const body = await readJson(req);
    const phone = normPhone(body.phone);
    const user = phone ? store.findUserByPhone(phone) : null;
    if (!user) throw httpError(404, 'No account with this phone number.', 'no_account');
    if (user.verified) throw httpError(400, 'This account is already verified.', 'already_verified');
    if (user.otpSentAt && Date.now() - user.otpSentAt < OTP_RESEND_COOLDOWN_MS) {
      throw httpError(429, 'Wait a moment before requesting another code.', 'resend_too_soon');
    }
    const code = issueOtp(user);
    verificationResponse(res, 200, user, code);
  });

  route('POST', '/api/login', async (req, res) => {
    const body = await readJson(req);
    const phone = normPhone(body.phone);
    const password = typeof body.password === 'string' ? body.password : '';
    const user = phone ? store.findUserByPhone(phone) : null;
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw httpError(401, 'Wrong phone number or password.', 'wrong_credentials');
    }
    if (!user.verified) {
      const code =
        user.otpSentAt && Date.now() - user.otpSentAt < OTP_RESEND_COOLDOWN_MS ? user.otpCode : issueOtp(user);
      verificationResponse(res, 403, user, code);
      return;
    }
    sendJson(res, 200, sessionPayload(user));
  });

  route('GET', '/api/me', async (req, res) => {
    const user = authUser(req);
    const activeRide = store.findActiveRideForUser(user.id);
    const driverLoc = hub && activeRide && activeRide.driverId ? hub.drivers.get(activeRide.driverId) : null;
    sendJson(res, 200, {
      user: publicUser(store, user.id),
      driverActive: hub ? hub.drivers.has(user.id) : false,
      activeRide,
      counterpart: rideCounterpart(store, activeRide, user.id),
      driverLocation: driverLoc ? { lat: driverLoc.lat, lng: driverLoc.lng } : null,
    });
  });

  route('PUT', '/api/me', async (req, res) => {
    const user = authUser(req);
    const body = await readJson(req);
    const patch = {};
    if ('name' in body) {
      const name = cleanStr(body.name, 60);
      if (name.length < 2) throw httpError(400, 'Enter your name.', 'name_required');
      patch.name = name;
    }
    if ('about' in body) {
      patch.about = cleanStr(body.about, 200) || null;
    }
    if ('city' in body) {
      patch.city = cleanStr(body.city, 60) || null;
    }
    if ('email' in body) {
      const email = cleanStr(body.email, 120);
      if (email && !isValidEmail(email)) throw httpError(400, 'Enter a valid email address.', 'invalid_email');
      patch.email = email || null;
    }
    if ('avatar' in body) {
      const avatar = body.avatar;
      if (avatar == null || avatar === '') {
        patch.avatar = null;
      } else {
        if (typeof avatar !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(avatar)) {
          throw httpError(400, 'Avatar must be an image.', 'invalid_avatar');
        }
        if (avatar.length > MAX_AVATAR_CHARS) throw httpError(400, 'Avatar image is too large.', 'avatar_too_large');
        patch.avatar = avatar;
      }
    }
    store.updateUser(user.id, patch);
    sendJson(res, 200, { user: publicUser(store, user.id) });
  });

  route('PUT', '/api/me/places', async (req, res) => {
    const user = authUser(req);
    const body = await readJson(req);
    const current = store.getUser(user.id).places || {};
    const next = { ...current };
    for (const kind of ['home', 'work']) {
      if (!(kind in body)) continue;
      const p = body[kind];
      if (p == null) {
        delete next[kind];
        continue;
      }
      if (!isLat(p.lat) || !isLng(p.lng)) throw httpError(400, 'Pick a point for this place.', 'invalid_place');
      const address = cleanStr(p.address, 200);
      if (!address) throw httpError(400, 'This place needs an address.', 'invalid_place');
      next[kind] = { lat: p.lat, lng: p.lng, address };
    }
    store.updateUser(user.id, { places: Object.keys(next).length ? next : null });
    sendJson(res, 200, { user: publicUser(store, user.id) });
  });

  route('PUT', '/api/me/driver', async (req, res) => {
    const user = authUser(req);
    const body = await readJson(req);
    const carMake = cleanStr(body.carMake, 40);
    const carModel = cleanStr(body.carModel, 40);
    const carColor = cleanStr(body.carColor, 30);
    const plate = cleanStr(body.plate, 16).toUpperCase();
    if (!carMake || !carModel || !carColor || !plate) {
      throw httpError(400, 'Car make, model, color and plate are all required.', 'car_required');
    }
    if (!/^[A-Z0-9][A-Z0-9 -]{0,15}$/.test(plate)) {
      throw httpError(400, 'Plate can contain letters, digits, spaces and dashes.', 'invalid_plate');
    }
    store.upsertDriverProfile(user.id, { carMake, carModel, carColor, plate });
    sendJson(res, 200, { user: publicUser(store, user.id) });
  });

  route('GET', '/api/users/:id', async (req, res, params) => {
    authUser(req);
    const profile = directoryUser(store, params.id);
    if (!profile) throw httpError(404, 'user not found');
    sendJson(res, 200, { user: { ...profile, recentComments: store.ratingComments(params.id, 5) } });
  });

  route('GET', '/api/rides', async (req, res) => {
    const user = authUser(req);
    const rides = store.listRidesForUser(user.id, 50).map((r) => {
      const otherId = r.riderId === user.id ? r.driverId : r.riderId;
      const other = otherId ? store.getUser(otherId) : null;
      const myRating = store.getRatingByRideAndRater(r.id, user.id);
      return {
        ...r,
        role: r.riderId === user.id ? 'rider' : 'driver',
        counterpartId: otherId,
        counterpartName: other ? other.name : null,
        myRating: myRating ? { stars: myRating.stars, comment: myRating.comment } : null,
      };
    });
    sendJson(res, 200, { rides });
  });

  route('POST', '/api/rides/:id/rating', async (req, res, params) => {
    const user = authUser(req);
    const ride = store.getRide(params.id);
    if (!ride || (ride.riderId !== user.id && ride.driverId !== user.id)) {
      throw httpError(404, 'ride not found');
    }
    if (ride.status !== 'finished') throw httpError(400, 'You can only rate finished rides.');
    const body = await readJson(req);
    const stars = Number(body.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw httpError(400, 'Rating must be 1 to 5 stars.');
    if (store.getRatingByRideAndRater(ride.id, user.id)) throw httpError(409, 'You already rated this ride.');
    const rateeId = ride.riderId === user.id ? ride.driverId : ride.riderId;
    const rating = store.addRating({
      rideId: ride.id,
      raterId: user.id,
      rateeId,
      stars,
      comment: cleanStr(body.comment, 300),
    });
    store.addPoints(user.id, 1); // small thank-you for rating
    if (hub) hub.sendTo(rateeId, { type: 'rating:received' });
    sendJson(res, 201, { ok: true, rating: { stars: rating.stars, comment: rating.comment } });
  });

  // Weekly recap: your last 7 days plus the whole movement's totals.
  route('GET', '/api/weekly', async (req, res) => {
    const user = authUser(req);
    const since = Date.now() - 7 * 24 * 3600 * 1000;
    const rides = store.listFinishedSince(since);
    const ptsFor = (r) => {
      const km = (r.distanceM || 0) / 1000;
      const minutes = Math.max(1, ((r.finishedAt || 0) - (r.startedAt || r.finishedAt || 0)) / 60000);
      return Math.max(1, Math.min(5000, Math.round(km * minutes)));
    };
    const byDriver = new Map();
    let km = 0;
    for (const r of rides) {
      km += (r.distanceM || 0) / 1000;
      if (r.driverId) {
        const e = byDriver.get(r.driverId) || { points: 0, rides: 0 };
        e.points += ptsFor(r);
        e.rides += 1;
        byDriver.set(r.driverId, e);
      }
    }
    const top = [...byDriver.entries()]
      .sort((a, b) => b[1].points - a[1].points)
      .slice(0, 3)
      .map(([uid, e]) => {
        const u = store.getUser(uid);
        return { name: u ? u.name : '?', points: e.points, rides: e.rides };
      });
    const drove = rides.filter((r) => r.driverId === user.id);
    const rode = rides.filter((r) => r.riderId === user.id);
    sendJson(res, 200, {
      since,
      me: {
        drove: drove.length,
        rode: rode.length,
        points: drove.reduce((s, r) => s + ptsFor(r), 0) + rode.length,
      },
      city: { rides: rides.length, km: Math.round(km), drivers: byDriver.size, top },
    });
  });

  // Neon trails: traces of rides finished in the last 24h, drawn on the map.
  route('GET', '/api/trails', async (req, res) => {
    authUser(req);
    sendJson(res, 200, { trails: store.listTrails(24, 200) });
  });

  // --- geocoding / routing proxy (OpenStreetMap services) ---

  route('GET', '/api/geo/reverse', async (req, res, params, url) => {
    authUser(req);
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    sendJson(res, 200, await reverseGeocode(lat, lng, url.searchParams.get('lang')));
  });

  route('GET', '/api/geo/search', async (req, res, params, url) => {
    authUser(req);
    const q = url.searchParams.get('q');
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    sendJson(res, 200, { results: await searchAddress(q, lat, lng, url.searchParams.get('lang')) });
  });

  route('GET', '/api/geo/route', async (req, res, params, url) => {
    authUser(req);
    const fromLat = Number(url.searchParams.get('fromLat'));
    const fromLng = Number(url.searchParams.get('fromLng'));
    const toLat = Number(url.searchParams.get('toLat'));
    const toLng = Number(url.searchParams.get('toLng'));
    sendJson(res, 200, await geoRoute(fromLat, fromLng, toLat, toLng));
  });

  // --------------------------------------------------------- dispatch ---

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      });
      res.end();
      return;
    }

    // Anything outside /api is the web app (when a build exists).
    if ((req.method === 'GET' || req.method === 'HEAD') && !path.startsWith('/api/')) {
      if (serveStatic && serveStatic(req, res, path)) return;
      if (path === '/') {
        sendJson(res, 200, { name: 'DrivePro server', ok: true, web: 'not built - run: cd app && npx expo export -p web' });
        return;
      }
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.regex.exec(path);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      try {
        await r.handler(req, res, params, url);
      } catch (e) {
        const status = e.status || 500;
        if (status === 500) console.error('API error:', e);
        sendJson(res, status, { error: e.message || 'internal error', ...(e.code ? { code: e.code } : {}) });
      }
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  };
}
