import { readJson, sendJson, httpError, normPhone, cleanStr, isLat, isLng, isValidEmail } from './util.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js';
import { publicUser, rideCounterpart, directoryUser } from './views.js';
import { reverseGeocode, searchAddress, route as geoRoute } from './geo.js';
import { generateCode, sendCode, OTP_TTL_MS, OTP_RESEND_COOLDOWN_MS, OTP_ECHO } from './otp.js';
import { vapidPublicKey } from './push.js';

const MAX_AVATAR_CHARS = 400_000; // ~300 KB of base64 image data
const OTP_MAX_ATTEMPTS = 5;
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim();

// Tiny in-memory per-IP rate limiter for the auth surface.
const rlBuckets = new Map(); // key -> number[] (timestamps)
function rateLimit(req, name, max, windowMs = 10 * 60 * 1000) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || (req.socket && req.socket.remoteAddress) || '?';
  const key = `${name}:${ip}`;
  const nowMs = Date.now();
  const arr = (rlBuckets.get(key) || []).filter((ts) => nowMs - ts < windowMs);
  if (arr.length >= max) {
    rlBuckets.set(key, arr);
    throw httpError(429, 'Too many attempts. Try again later.', 'rate_limited');
  }
  arr.push(nowMs);
  rlBuckets.set(key, arr);
  if (rlBuckets.size > 5000) {
    for (const [k, v] of rlBuckets) if (!v.length || nowMs - v[v.length - 1] > windowMs) rlBuckets.delete(k);
  }
}

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
    if (user.banned) throw httpError(403, 'This account is suspended.', 'banned');
    return user;
  };

  const adminAuth = (req) => {
    if (!ADMIN_TOKEN) throw httpError(404, 'not found');
    if (String(req.headers['x-admin-token'] || '') !== ADMIN_TOKEN) throw httpError(401, 'admin token required');
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
    store.updateUser(user.id, { otpCode: code, otpExpires: Date.now() + OTP_TTL_MS, otpSentAt: Date.now(), otpAttempts: 0 });
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
    rateLimit(req, 'register', 30);
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
    rateLimit(req, 'verify', 30);
    const body = await readJson(req);
    const phone = normPhone(body.phone);
    const code = cleanStr(body.code, 8);
    const user = phone ? store.findUserByPhone(phone) : null;
    if (!user) throw httpError(404, 'No account with this phone number.', 'no_account');
    if (user.banned) throw httpError(403, 'This account is suspended.', 'banned');
    if (user.verified) {
      sendJson(res, 200, sessionPayload(user));
      return;
    }
    if (!user.otpCode || !user.otpExpires || user.otpExpires < Date.now()) {
      throw httpError(400, 'The code has expired. Request a new one.', 'code_expired');
    }
    if (user.otpCode !== code) {
      const attempts = (user.otpAttempts || 0) + 1;
      if (attempts >= OTP_MAX_ATTEMPTS) {
        // Burn the code entirely: guessing is over, a new one must be requested.
        store.updateUser(user.id, { otpCode: null, otpExpires: null, otpAttempts: 0 });
        throw httpError(429, 'Too many wrong codes. Request a new one.', 'code_locked');
      }
      store.updateUser(user.id, { otpAttempts: attempts });
      throw httpError(400, 'Wrong code. Check and try again.', 'code_wrong');
    }
    store.updateUser(user.id, { verified: true, otpCode: null, otpExpires: null, otpAttempts: 0 });
    sendJson(res, 200, sessionPayload(store.getUser(user.id)));
  });

  route('POST', '/api/resend', async (req, res) => {
    rateLimit(req, 'resend', 10);
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
    rateLimit(req, 'login', 20);
    const body = await readJson(req);
    const phone = normPhone(body.phone);
    const password = typeof body.password === 'string' ? body.password : '';
    const user = phone ? store.findUserByPhone(phone) : null;
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw httpError(401, 'Wrong phone number or password.', 'wrong_credentials');
    }
    if (user.banned) throw httpError(403, 'This account is suspended.', 'banned');
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
      driverRides: store
        .listActiveRidesForDriver(user.id)
        .map((r) => ({ ride: r, rider: rideCounterpart(store, r, user.id) })),
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

  // -------------------------------------------------------- web push ---
  route('GET', '/api/push/key', async (req, res) => {
    authUser(req);
    sendJson(res, 200, { key: vapidPublicKey() });
  });

  route('POST', '/api/push/subscribe', async (req, res) => {
    const user = authUser(req);
    const body = await readJson(req);
    if (!store.savePushSub(user.id, body.subscription)) throw httpError(400, 'invalid subscription');
    sendJson(res, 200, { ok: true });
  });

  route('POST', '/api/push/unsubscribe', async (req, res) => {
    authUser(req);
    const body = await readJson(req);
    if (typeof body.endpoint === 'string') store.dropPushSub(body.endpoint);
    sendJson(res, 200, { ok: true });
  });

  // ------------------------------------------- trust: block / report ---
  route('POST', '/api/users/:id/block', async (req, res, params) => {
    const user = authUser(req);
    const other = store.getUser(params.id);
    if (!other || other.id === user.id) throw httpError(404, 'user not found');
    store.block(user.id, other.id);
    sendJson(res, 200, { ok: true, blocked: true });
  });

  route('POST', '/api/users/:id/unblock', async (req, res, params) => {
    const user = authUser(req);
    store.unblock(user.id, params.id);
    sendJson(res, 200, { ok: true, blocked: false });
  });

  route('GET', '/api/me/blocks', async (req, res) => {
    const user = authUser(req);
    sendJson(res, 200, { blocked: store.listBlockedIds(user.id) });
  });

  route('POST', '/api/users/:id/report', async (req, res, params) => {
    rateLimit(req, 'report', 10);
    const user = authUser(req);
    const other = store.getUser(params.id);
    if (!other || other.id === user.id) throw httpError(404, 'user not found');
    const body = await readJson(req);
    store.addReport({ reporterId: user.id, reportedId: other.id, rideId: cleanStr(body.rideId, 60) || null, reason: cleanStr(body.reason, 300) || null });
    sendJson(res, 201, { ok: true });
  });

  // ------------------------------------------- trust: share-my-ride ---
  route('POST', '/api/rides/:id/share', async (req, res, params) => {
    const user = authUser(req);
    const ride = store.getRide(params.id);
    if (!ride || (ride.riderId !== user.id && ride.driverId !== user.id)) throw httpError(404, 'ride not found');
    const shareId = store.shareForRide(ride.id);
    sendJson(res, 200, { shareId, path: `/share/${shareId}` });
  });

  // Public: no auth - safe subset only (no phones, no rider identity).
  route('GET', '/api/share/:id', async (req, res, params) => {
    const rideId = store.rideIdByShare(params.id);
    const ride = rideId ? store.getRide(rideId) : null;
    if (!ride) throw httpError(404, 'not found');
    const driver = ride.driverId ? store.getUser(ride.driverId) : null;
    const dp = ride.driverId ? store.getDriverProfile(ride.driverId) : null;
    const loc = hub && ride.driverId ? hub.driverLocation(ride.driverId) : null;
    sendJson(res, 200, {
      status: ride.status,
      pickup: { lat: ride.pickupLat, lng: ride.pickupLng, address: ride.pickupAddress },
      dest: { lat: ride.destLat, lng: ride.destLng, address: ride.destAddress },
      driver: driver
        ? { name: driver.name, car: dp ? `${dp.carColor} ${dp.carMake} ${dp.carModel}` : null, plate: dp ? dp.plate : null }
        : null,
      driverLocation: loc ? { lat: loc.lat, lng: loc.lng } : null,
      updatedAt: Date.now(),
    });
  });

  // ------------------------------------------------------------- admin ---
  // Enabled only when ADMIN_TOKEN is set in the environment.
  route('GET', '/api/admin/overview', async (req, res) => {
    adminAuth(req);
    const users = store.listUsers(300).map((u) => ({
      id: u.id,
      name: u.name,
      phone: u.phone,
      points: u.points || 0,
      banned: !!u.banned,
      verified: !!u.verified,
      createdAt: u.createdAt,
      rides: store.countFinishedRides(u.id),
    }));
    const active = store.listAllActiveRides();
    const nameOf = (uid) => {
      const u = store.getUser(uid);
      return u ? u.name : uid;
    };
    const reports = store.listReports(50).map((r) => ({
      reporter: nameOf(r.reporterId),
      reported: nameOf(r.reportedId),
      reportedId: r.reportedId,
      reason: r.reason,
      createdAt: r.createdAt,
    }));
    sendJson(res, 200, { users, activeRides: active.length, totalUsers: users.length, reports });
  });

  route('POST', '/api/admin/users/:id/ban', async (req, res, params) => {
    adminAuth(req);
    const body = await readJson(req);
    const user = store.getUser(params.id);
    if (!user) throw httpError(404, 'user not found');
    store.updateUser(user.id, { banned: !!body.banned });
    sendJson(res, 200, { ok: true, banned: !!body.banned });
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

    // Crew standings: sum of members' points earned this week (driver points
    // per ride + rider's +1), ranked across all crews.
    const crewAgg = new Map(); // crewId -> { points, rides }
    const feed = (uid, pts) => {
      const u = uid && store.getUser(uid);
      if (!u || !u.crewId) return;
      const e = crewAgg.get(u.crewId) || { points: 0, rides: 0 };
      e.points += pts;
      e.rides += 1;
      crewAgg.set(u.crewId, e);
    };
    for (const r of rides) {
      feed(r.driverId, ptsFor(r));
      feed(r.riderId, 1);
    }
    const rankedCrews = [...crewAgg.entries()].sort((a, b) => b[1].points - a[1].points);
    const crewsTop = rankedCrews
      .slice(0, 3)
      .map(([cid, e]) => {
        const c = store.getCrew(cid);
        return c ? { name: c.name, points: e.points, rides: e.rides, members: store.crewMembers(cid).length } : null;
      })
      .filter(Boolean);
    const meUser = store.getUser(user.id);
    let myCrew = null;
    if (meUser && meUser.crewId) {
      const c = store.getCrew(meUser.crewId);
      if (c) {
        const idx = rankedCrews.findIndex(([cid]) => cid === meUser.crewId);
        myCrew = {
          name: c.name,
          points: idx >= 0 ? rankedCrews[idx][1].points : 0,
          rank: idx >= 0 ? idx + 1 : null,
        };
      }
    }

    sendJson(res, 200, {
      since,
      me: {
        drove: drove.length,
        rode: rode.length,
        points: drove.reduce((s, r) => s + ptsFor(r), 0) + rode.length,
        streak: (meUser || {}).streakDays || 0,
        crew: myCrew,
      },
      city: { rides: rides.length, km: Math.round(km), drivers: byDriver.size, top, crews: crewsTop },
    });
  });

  // ---- crews: private squads joined by invite code (L13) ----
  const CREW_MAX = Number(process.env.DRIVEPRO_CREW_MAX || 20);
  const weekRides = () => store.listFinishedSince(Date.now() - 7 * 24 * 3600 * 1000);
  const ridePts = (r) => {
    const km = (r.distanceM || 0) / 1000;
    const minutes = Math.max(1, ((r.finishedAt || 0) - (r.startedAt || r.finishedAt || 0)) / 60000);
    return Math.max(1, Math.min(5000, Math.round(km * minutes)));
  };
  const crewView = (crew, forMember) => ({
    id: crew.id,
    name: crew.name,
    points: crew.points || 0,
    createdAt: crew.createdAt,
    ...(forMember ? { code: crew.code, ownerId: crew.ownerId } : {}),
  });
  const myCrewPayload = (user) => {
    const crew = store.getCrew(user.crewId);
    if (!crew) return { crew: null };
    const rides = weekRides();
    const week = new Map(); // uid -> { points, rides }
    for (const r of rides) {
      if (r.driverId) {
        const e = week.get(r.driverId) || { points: 0, rides: 0 };
        e.points += ridePts(r);
        e.rides += 1;
        week.set(r.driverId, e);
      }
      const e = week.get(r.riderId) || { points: 0, rides: 0 };
      e.points += 1;
      e.rides += 1;
      week.set(r.riderId, e);
    }
    let weekPoints = 0;
    let weekRideCount = 0;
    const members = store.crewMembers(crew.id).map((m) => {
      const w = week.get(m.id) || { points: 0, rides: 0 };
      weekPoints += w.points;
      weekRideCount += w.rides;
      const pub = directoryUser(store, m.id);
      return { ...pub, weekPoints: w.points, isOwner: m.id === crew.ownerId };
    });
    return { crew: crewView(crew, true), members, week: { points: weekPoints, rides: weekRideCount } };
  };

  route('POST', '/api/crews', async (req, res) => {
    const user = authUser(req);
    if (user.crewId && store.getCrew(user.crewId)) throw httpError(400, 'You are already in a crew.', 'already_in_crew');
    const body = await readJson(req);
    const name = cleanStr(body.name, 30);
    if (name.length < 2) throw httpError(400, 'Give your crew a name.', 'crew_name_required');
    const crew = store.createCrew(user.id, name);
    if (!crew) throw httpError(500, 'Could not create the crew. Try again.');
    sendJson(res, 200, myCrewPayload(store.getUser(user.id)));
  });

  route('POST', '/api/crews/join', async (req, res) => {
    const user = authUser(req);
    if (user.crewId && store.getCrew(user.crewId)) throw httpError(400, 'You are already in a crew.', 'already_in_crew');
    const body = await readJson(req);
    const code = String(body.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const crew = code ? store.findCrewByCode(code) : null;
    if (!crew) throw httpError(404, 'No crew with this code.', 'crew_not_found');
    if (store.crewMembers(crew.id).length >= CREW_MAX) throw httpError(400, 'This crew is full.', 'crew_full');
    store.joinCrew(user.id, crew.id);
    sendJson(res, 200, myCrewPayload(store.getUser(user.id)));
  });

  route('POST', '/api/crews/leave', async (req, res) => {
    const user = authUser(req);
    if (!user.crewId || !store.getCrew(user.crewId)) throw httpError(400, 'You are not in a crew.', 'not_in_crew');
    store.leaveCrew(user.id);
    sendJson(res, 200, { ok: true, crew: null });
  });

  route('GET', '/api/crews/mine', async (req, res) => {
    const user = authUser(req);
    if (!user.crewId || !store.getCrew(user.crewId)) {
      sendJson(res, 200, { crew: null });
      return;
    }
    sendJson(res, 200, myCrewPayload(user));
  });

  // ---- scheduled & recurring rides (L14) ----
  const SCHED_MAX = Number(process.env.DRIVEPRO_SCHED_MAX || 10);
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const localDayKey = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const schedView = (s) => ({
    id: s.id,
    pickup: { lat: s.pickupLat, lng: s.pickupLng, address: s.pickupAddress },
    dest: { lat: s.destLat, lng: s.destLng, address: s.destAddress },
    time: s.time,
    days: s.days || null,
    date: s.date || null,
    comment: s.comment || null,
    active: !!s.active,
    createdAt: s.createdAt,
  });

  route('GET', '/api/schedules', async (req, res) => {
    const user = authUser(req);
    sendJson(res, 200, { schedules: store.listSchedules(user.id).map(schedView) });
  });

  route('POST', '/api/schedules', async (req, res) => {
    const user = authUser(req);
    if (store.listSchedules(user.id).length >= SCHED_MAX)
      throw httpError(400, `You can keep up to ${SCHED_MAX} schedules.`, 'too_many_schedules');
    const body = await readJson(req);
    const p = body.pickup || {};
    const d = body.dest || {};
    if (!isLat(p.lat) || !isLng(p.lng) || !isLat(d.lat) || !isLng(d.lng))
      throw httpError(400, 'Pickup and destination are required.', 'points_required');
    const time = String(body.time || '').trim();
    if (!TIME_RE.test(time)) throw httpError(400, 'Enter the departure time as HH:MM.', 'invalid_time');
    let days = null;
    let date = null;
    if (body.date != null && body.date !== '') {
      date = String(body.date).trim();
      if (!DATE_RE.test(date) || date < localDayKey(Date.now()))
        throw httpError(400, 'Pick a valid future date.', 'invalid_date');
    } else {
      days = Array.isArray(body.days) ? [...new Set(body.days.map(Number))].filter((n) => n >= 1 && n <= 7) : [];
      if (!days.length) throw httpError(400, 'Pick at least one weekday or a date.', 'invalid_days');
      days.sort((a, b) => a - b);
    }
    const schedule = store.createSchedule({
      riderId: user.id,
      pickupLat: p.lat,
      pickupLng: p.lng,
      pickupAddress: cleanStr(p.address, 200),
      destLat: d.lat,
      destLng: d.lng,
      destAddress: cleanStr(d.address, 200),
      time,
      days,
      date,
      comment: cleanStr(body.comment, 300) || null,
    });
    sendJson(res, 200, { schedule: schedView(schedule) });
  });

  route('PUT', '/api/schedules/:id', async (req, res, params) => {
    const user = authUser(req);
    const s = store.getSchedule(params.id);
    if (!s || s.riderId !== user.id) throw httpError(404, 'No such schedule.', 'schedule_not_found');
    const body = await readJson(req);
    if (typeof body.active === 'boolean') store.updateSchedule(s.id, { active: body.active });
    sendJson(res, 200, { schedule: schedView(store.getSchedule(s.id)) });
  });

  route('DELETE', '/api/schedules/:id', async (req, res, params) => {
    const user = authUser(req);
    const s = store.getSchedule(params.id);
    if (!s || s.riderId !== user.id) throw httpError(404, 'No such schedule.', 'schedule_not_found');
    store.deleteSchedule(s.id);
    sendJson(res, 200, { ok: true });
  });

  // Live city impact: today's shared rides + km, plus drivers online now.
  route('GET', '/api/city/impact', async (req, res) => {
    authUser(req);
    sendJson(res, 200, hub && hub.impactProvider ? hub.impactProvider() : { rides: 0, km: 0, driversOnline: 0 });
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

    // Public live share page.
    if (req.method === 'GET' && path.startsWith('/share/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(SHARE_HTML);
      return;
    }

    // Minimal operator panel (enabled only with ADMIN_TOKEN set).
    if (req.method === 'GET' && path === '/admin' && ADMIN_TOKEN) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(ADMIN_HTML);
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

// Dark one-file operator panel; token stays in the browser's localStorage.
const ADMIN_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>DrivePro · admin</title><style>
body{background:#06070d;color:#e9f2ff;font-family:-apple-system,system-ui,sans-serif;margin:0;padding:24px}
h1{font-size:20px;letter-spacing:1px} .sub{color:#8b96b8;font-size:13px}
input{background:#0a0e1a;color:#e9f2ff;border:1px solid #223052;border-radius:10px;padding:10px 12px;font-size:14px;width:280px}
button{background:#00e5ff;color:#02141a;border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer}
button.ghost{background:transparent;color:#e9f2ff;border:1px solid #254a63}
table{border-collapse:collapse;width:100%;margin-top:18px;font-size:13px}
td,th{padding:8px 10px;border-bottom:1px solid #1c2438;text-align:left}
th{color:#8b96b8;font-weight:600;text-transform:uppercase;font-size:11px}
.badge{color:#f5c518}.banned{color:#ff3b5c;font-weight:700}.ok{color:#00ffa3}
</style></head><body>
<h1>DRIVEPRO <span class="sub">operator panel</span></h1>
<div id="login"><p class="sub">Admin token</p><input id="tok" type="password"/> <button onclick="save()">Enter</button></div>
<div id="panel" style="display:none">
  <p class="sub" id="stats"></p>
  <table><thead><tr><th>Name</th><th>Phone</th><th>⚡</th><th>Rides</th><th>Status</th><th></th></tr></thead><tbody id="rows"></tbody></table>
  <h1 style="margin-top:28px">Reports</h1>
  <table><thead><tr><th>When</th><th>Reporter</th><th>Reported</th><th>Reason</th></tr></thead><tbody id="reps"></tbody></table>
  <p><button class="ghost" onclick="localStorage.removeItem('admtok');location.reload()">Log out</button></p>
</div>
<script>
const tok = () => localStorage.getItem('admtok') || '';
function save(){ localStorage.setItem('admtok', document.getElementById('tok').value.trim()); load(); }
async function ban(id, b){ await fetch('/api/admin/users/'+id+'/ban',{method:'POST',headers:{'Content-Type':'application/json','x-admin-token':tok()},body:JSON.stringify({banned:b})}); load(); }
async function load(){
  if(!tok()) return;
  const r = await fetch('/api/admin/overview',{headers:{'x-admin-token':tok()}});
  if(!r.ok){ localStorage.removeItem('admtok'); return; }
  const d = await r.json();
  document.getElementById('login').style.display='none';
  document.getElementById('panel').style.display='block';
  document.getElementById('stats').textContent = d.totalUsers+' users · '+d.activeRides+' active rides';
  document.getElementById('reps').innerHTML = (d.reports||[]).map(r =>
    '<tr><td>'+new Date(r.createdAt).toLocaleString()+'</td><td>'+r.reporter+'</td><td class="banned">'+r.reported+'</td><td>'+(r.reason||'')+'</td></tr>'
  ).join('') || '<tr><td colspan="4" class="sub">none</td></tr>';
  document.getElementById('rows').innerHTML = d.users.map(u =>
    '<tr><td>'+u.name+'</td><td>'+u.phone+'</td><td class="badge">'+u.points+'</td><td>'+u.rides+'</td>'+
    '<td class="'+(u.banned?'banned':'ok')+'">'+(u.banned?'BANNED':(u.verified?'active':'unverified'))+'</td>'+
    '<td><button class="ghost" onclick="ban(\''+u.id+'\','+(!u.banned)+')">'+(u.banned?'Unban':'Ban')+'</button></td></tr>'
  ).join('');
}
load();
</script></body></html>`;

// Public live-tracking page for a shared ride; polls the JSON endpoint.
const SHARE_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>DrivePro · live ride</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"/>
<style>
body{background:#06070d;color:#e9f2ff;font-family:-apple-system,system-ui,sans-serif;margin:0;display:flex;flex-direction:column;height:100vh}
#map{flex:1}
#panel{padding:14px 18px;border-top:1px solid #1c2438;background:#0e1220}
h1{font-size:16px;margin:0 0 4px;letter-spacing:1px}
.sub{color:#8b96b8;font-size:13px;margin:2px 0}
.status{color:#00e5ff;font-weight:700}
.leaflet-control-attribution{background:rgba(6,7,13,.6)!important;color:#5a6684!important;font-size:9px}
</style></head><body>
<div id="map"></div>
<div id="panel"><h1>DRIVEPRO <span class="sub">live ride</span></h1>
<div class="status" id="st">…</div><div class="sub" id="drv"></div><div class="sub" id="route"></div></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
const shareId = location.pathname.split('/').pop();
const map = L.map('map', { zoomControl: false }).setView([43.2389, 76.8897], 13);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', attribution: '© OpenStreetMap © CARTO' }).addTo(map);
let car = null, pins = [], fitted = false;
const dot = (color) => L.divIcon({ className: '', html: '<div style="width:15px;height:15px;border-radius:50%;background:'+color+';border:2px solid rgba(233,242,255,.9);box-shadow:0 0 10px 2px '+color+'"></div>', iconSize: [15,15], iconAnchor: [8,8] });
const STATUS = { requested: 'Ищем водителя…', accepted: 'Водитель в пути', arrived: 'Водитель на месте', in_progress: 'В пути', finished: 'Поездка завершена ✓', cancelled: 'Поездка отменена' };
async function tick(){
  try{
    const r = await fetch('/api/share/'+shareId);
    if(!r.ok){ document.getElementById('st').textContent = 'Ссылка не найдена'; return; }
    const d = await r.json();
    document.getElementById('st').textContent = STATUS[d.status] || d.status;
    document.getElementById('drv').textContent = d.driver ? (d.driver.name + ' · ' + (d.driver.car||'') + ' · ' + (d.driver.plate||'')) : '';
    document.getElementById('route').textContent = (d.pickup.address||'') + ' → ' + (d.dest.address||'');
    if(!pins.length){
      pins = [ L.marker([d.pickup.lat, d.pickup.lng], {icon: dot('#00ffa3')}).addTo(map), L.marker([d.dest.lat, d.dest.lng], {icon: dot('#ff3b5c')}).addTo(map) ];
    }
    if(d.driverLocation){
      if(!car) car = L.marker([d.driverLocation.lat, d.driverLocation.lng], { icon: L.divIcon({className:'',html:'<div style="font-size:24px;filter:drop-shadow(0 0 6px rgba(0,229,255,.9))">🚗</div>',iconSize:[26,26],iconAnchor:[13,13]}) }).addTo(map);
      else car.setLatLng([d.driverLocation.lat, d.driverLocation.lng]);
    }
    if(!fitted){ fitted = true; const pts = [[d.pickup.lat,d.pickup.lng],[d.dest.lat,d.dest.lng]]; if(d.driverLocation) pts.push([d.driverLocation.lat,d.driverLocation.lng]); map.fitBounds(pts, { padding:[40,40] }); }
    if(d.status === 'finished' || d.status === 'cancelled') clearInterval(iv);
  }catch(e){}
}
const iv = setInterval(tick, 5000); tick();
</script></body></html>`;
