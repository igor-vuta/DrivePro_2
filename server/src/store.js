import fs from 'node:fs';
import path from 'node:path';
import { id, now } from './util.js';

// Storage layer with two interchangeable backends:
//  - SQLite via node:sqlite (Node >= 22.5)
//  - JSON file fallback for older Node versions
// Both expose the same repository API used by the rest of the server.

export const RIDE_STATUSES = ['requested', 'accepted', 'arrived', 'in_progress', 'finished', 'cancelled'];
export const ACTIVE_RIDE_STATUSES = ['requested', 'accepted', 'arrived', 'in_progress'];

function loadSqlite() {
  if (process.env.DRIVEPRO_STORAGE === 'json') return null;
  try {
    // eslint-disable-next-line no-undef
    const mod = process.getBuiltinModule && process.getBuiltinModule('node:sqlite');
    return mod && mod.DatabaseSync ? mod : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- SQLite ---

class SqliteBackend {
  constructor(dataDir, sqlite) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new sqlite.DatabaseSync(path.join(dataDir, 'drivepro.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        phone TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        verified INTEGER DEFAULT 0,
        otp_code TEXT,
        otp_expires INTEGER,
        otp_sent_at INTEGER,
        avatar TEXT,
        about TEXT,
        email TEXT,
        city TEXT,
        places TEXT,
        points INTEGER DEFAULT 0,
        otp_attempts INTEGER DEFAULT 0,
        banned INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS driver_profiles (
        user_id TEXT PRIMARY KEY,
        car_make TEXT NOT NULL,
        car_model TEXT NOT NULL,
        car_color TEXT NOT NULL,
        plate TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rides (
        id TEXT PRIMARY KEY,
        rider_id TEXT NOT NULL,
        driver_id TEXT,
        status TEXT NOT NULL,
        pickup_lat REAL NOT NULL,
        pickup_lng REAL NOT NULL,
        pickup_address TEXT,
        dest_lat REAL,
        dest_lng REAL,
        dest_address TEXT,
        comment TEXT,
        distance_m INTEGER,
        duration_s INTEGER,
        created_at INTEGER NOT NULL,
        accepted_at INTEGER,
        arrived_at INTEGER,
        started_at INTEGER,
        finished_at INTEGER,
        cancelled_at INTEGER,
        cancelled_by TEXT,
        pickup_details TEXT,
        dest_details TEXT
      );
      CREATE TABLE IF NOT EXISTS ratings (
        id TEXT PRIMARY KEY,
        ride_id TEXT NOT NULL,
        rater_id TEXT NOT NULL,
        ratee_id TEXT NOT NULL,
        stars INTEGER NOT NULL,
        comment TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE (ride_id, rater_id)
      );
      CREATE TABLE IF NOT EXISTS trails (
        ride_id TEXT PRIMARY KEY,
        points TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        finished_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS blocks (
        blocker_id TEXT NOT NULL,
        blocked_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (blocker_id, blocked_id)
      );
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        reporter_id TEXT NOT NULL,
        reported_id TEXT NOT NULL,
        ride_id TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shares (
        share_id TEXT PRIMARY KEY,
        ride_id TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trails_finished ON trails (finished_at);
      CREATE INDEX IF NOT EXISTS idx_rides_rider ON rides (rider_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides (driver_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_ratings_ratee ON ratings (ratee_id);
    `);
    this._migrate();
  }

  // Add columns introduced after the first release to pre-existing databases.
  _migrate() {
    const addMissing = (table, defs) => {
      const have = this.db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
      const added = [];
      for (const [col, decl] of defs) {
        if (!have.includes(col)) {
          this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
          added.push(col);
        }
      }
      return added;
    };
    const addedUsers = addMissing('users', [
      ['verified', 'INTEGER DEFAULT 0'],
      ['otp_code', 'TEXT'],
      ['otp_expires', 'INTEGER'],
      ['otp_sent_at', 'INTEGER'],
      ['avatar', 'TEXT'],
      ['about', 'TEXT'],
      ['email', 'TEXT'],
      ['city', 'TEXT'],
      ['places', 'TEXT'],
      ['points', 'INTEGER DEFAULT 0'],
      ['otp_attempts', 'INTEGER DEFAULT 0'],
      ['banned', 'INTEGER DEFAULT 0'],
    ]);
    // Accounts created before verification existed stay usable.
    if (addedUsers.includes('verified')) {
      this.db.exec('UPDATE users SET verified = 1');
    }
    addMissing('rides', [
      ['pickup_details', 'TEXT'],
      ['dest_details', 'TEXT'],
    ]);
  }

  // users
  insertUser(u) {
    this.db
      .prepare(
        'INSERT INTO users (id, phone, password_hash, name, created_at, verified, otp_code, otp_expires, otp_sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(u.id, u.phone, u.passwordHash, u.name, u.createdAt, u.verified ? 1 : 0, u.otpCode ?? null, u.otpExpires ?? null, u.otpSentAt ?? null);
  }
  userByPhone(phone) {
    return rowToUser(this.db.prepare('SELECT * FROM users WHERE phone = ?').get(phone));
  }
  userById(uid) {
    return rowToUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(uid));
  }
  updateUserFields(uid, patch) {
    const map = {
      name: 'name', verified: 'verified', otpCode: 'otp_code', otpExpires: 'otp_expires',
      otpSentAt: 'otp_sent_at', avatar: 'avatar', about: 'about', email: 'email', city: 'city', places: 'places',
      otpAttempts: 'otp_attempts', banned: 'banned',
    };
    const cols = [];
    const vals = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in map)) continue;
      cols.push(`${map[k]} = ?`);
      vals.push(k === 'verified' || k === 'banned' ? (v ? 1 : 0) : k === 'places' && v != null ? JSON.stringify(v) : v);
    }
    if (!cols.length) return;
    vals.push(uid);
    this.db.prepare(`UPDATE users SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
  }
  addPoints(uid, n) {
    this.db.prepare('UPDATE users SET points = COALESCE(points, 0) + ? WHERE id = ?').run(n, uid);
  }

  // trails (neon traces of finished rides)
  putTrail(rideId, pointsJson, createdAt) {
    this.db
      .prepare('INSERT OR REPLACE INTO trails (ride_id, points, created_at, finished_at) VALUES (?, ?, ?, NULL)')
      .run(rideId, pointsJson, createdAt);
    this.db.prepare('DELETE FROM trails WHERE created_at < ?').run(createdAt - 48 * 3600 * 1000);
  }
  finishTrail(rideId, ts) {
    this.db.prepare('UPDATE trails SET finished_at = ? WHERE ride_id = ?').run(ts, rideId);
  }
  listTrails(sinceMs, limit) {
    return this.db
      .prepare('SELECT points, finished_at FROM trails WHERE finished_at IS NOT NULL AND finished_at >= ? ORDER BY finished_at DESC LIMIT ?')
      .all(sinceMs, limit)
      .map((r) => ({ points: safeParse(r.points), finishedAt: Number(r.finished_at) }))
      .filter((t) => Array.isArray(t.points) && t.points.length >= 2);
  }
  finishedRidesSince(sinceMs) {
    return this.db
      .prepare("SELECT * FROM rides WHERE status = 'finished' AND finished_at >= ?")
      .all(sinceMs)
      .map(rowToRide);
  }

  // driver profiles
  upsertDriver(p) {
    this.db
      .prepare(
        `INSERT INTO driver_profiles (user_id, car_make, car_model, car_color, plate, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           car_make = excluded.car_make, car_model = excluded.car_model,
           car_color = excluded.car_color, plate = excluded.plate, updated_at = excluded.updated_at`
      )
      .run(p.userId, p.carMake, p.carModel, p.carColor, p.plate, p.createdAt, p.updatedAt);
  }
  driverByUserId(uid) {
    return rowToDriver(this.db.prepare('SELECT * FROM driver_profiles WHERE user_id = ?').get(uid));
  }

  // rides
  insertRide(r) {
    this.db
      .prepare(
        `INSERT INTO rides (id, rider_id, driver_id, status, pickup_lat, pickup_lng, pickup_address,
          dest_lat, dest_lng, dest_address, comment, distance_m, duration_s, created_at,
          pickup_details, dest_details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        r.id, r.riderId, r.driverId ?? null, r.status, r.pickupLat, r.pickupLng, r.pickupAddress ?? null,
        r.destLat ?? null, r.destLng ?? null, r.destAddress ?? null, r.comment ?? null,
        r.distanceM ?? null, r.durationS ?? null, r.createdAt,
        r.pickupDetails ? JSON.stringify(r.pickupDetails) : null,
        r.destDetails ? JSON.stringify(r.destDetails) : null
      );
  }
  rideById(rid) {
    return rowToRide(this.db.prepare('SELECT * FROM rides WHERE id = ?').get(rid));
  }
  updateRide(rid, patch) {
    const map = {
      driverId: 'driver_id', status: 'status', acceptedAt: 'accepted_at', arrivedAt: 'arrived_at',
      startedAt: 'started_at', finishedAt: 'finished_at', cancelledAt: 'cancelled_at',
      cancelledBy: 'cancelled_by', distanceM: 'distance_m', durationS: 'duration_s',
      pickupAddress: 'pickup_address', destAddress: 'dest_address',
    };
    const cols = [];
    const vals = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in map)) continue;
      cols.push(`${map[k]} = ?`);
      vals.push(v);
    }
    if (!cols.length) return;
    vals.push(rid);
    this.db.prepare(`UPDATE rides SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
  }
  activeRideForUser(uid) {
    const q = ACTIVE_RIDE_STATUSES.map(() => '?').join(', ');
    const row = this.db
      .prepare(
        `SELECT * FROM rides WHERE (rider_id = ? OR driver_id = ?) AND status IN (${q})
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(uid, uid, ...ACTIVE_RIDE_STATUSES);
    return rowToRide(row);
  }
  activeRideAsRider(uid) {
    const q = ACTIVE_RIDE_STATUSES.map(() => '?').join(', ');
    const row = this.db
      .prepare(`SELECT * FROM rides WHERE rider_id = ? AND status IN (${q}) ORDER BY created_at DESC LIMIT 1`)
      .get(uid, ...ACTIVE_RIDE_STATUSES);
    return rowToRide(row);
  }
  activeRidesAsDriver(uid) {
    const q = ACTIVE_RIDE_STATUSES.map(() => '?').join(', ');
    return this.db
      .prepare(`SELECT * FROM rides WHERE driver_id = ? AND status IN (${q}) ORDER BY created_at ASC`)
      .all(uid, ...ACTIVE_RIDE_STATUSES)
      .map(rowToRide);
  }
  allActiveRides() {
    const q = ACTIVE_RIDE_STATUSES.map(() => '?').join(', ');
    return this.db.prepare(`SELECT * FROM rides WHERE status IN (${q})`).all(...ACTIVE_RIDE_STATUSES).map(rowToRide);
  }
  allUsers(limit = 300) {
    return this.db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ?').all(limit).map(rowToUser);
  }

  // blocks / reports / share links
  putBlock(a, b, ts) {
    this.db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(a, b, ts);
  }
  dropBlock(a, b) {
    this.db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(a, b);
  }
  blockedEither(a, b) {
    return !!this.db
      .prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1')
      .get(a, b, b, a);
  }
  blockedBy(a) {
    return this.db.prepare('SELECT blocked_id FROM blocks WHERE blocker_id = ?').all(a).map((r) => r.blocked_id);
  }
  putReport(r) {
    this.db
      .prepare('INSERT INTO reports (id, reporter_id, reported_id, ride_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.id, r.reporterId, r.reportedId, r.rideId ?? null, r.reason ?? null, r.createdAt);
  }
  allReports(limit = 100) {
    return this.db
      .prepare('SELECT * FROM reports ORDER BY created_at DESC LIMIT ?')
      .all(limit)
      .map((r) => ({ id: r.id, reporterId: r.reporter_id, reportedId: r.reported_id, rideId: r.ride_id, reason: r.reason, createdAt: Number(r.created_at) }));
  }
  putShare(shareId, rideId, ts) {
    this.db.prepare('INSERT OR IGNORE INTO shares (share_id, ride_id, created_at) VALUES (?, ?, ?)').run(shareId, rideId, ts);
  }
  shareByRide(rideId) {
    const row = this.db.prepare('SELECT share_id FROM shares WHERE ride_id = ?').get(rideId);
    return row ? row.share_id : null;
  }
  rideByShare(shareId) {
    const row = this.db.prepare('SELECT ride_id FROM shares WHERE share_id = ?').get(shareId);
    return row ? row.ride_id : null;
  }
  ridesForUser(uid, limit = 50) {
    return this.db
      .prepare('SELECT * FROM rides WHERE rider_id = ? OR driver_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(uid, uid, limit)
      .map(rowToRide);
  }
  countFinishedRides(uid) {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM rides WHERE status = 'finished' AND (rider_id = ? OR driver_id = ?)`)
      .get(uid, uid);
    return row ? Number(row.n) : 0;
  }
  requestedRides(maxAgeMs) {
    return this.db
      .prepare(`SELECT * FROM rides WHERE status = 'requested' AND created_at > ? ORDER BY created_at DESC`)
      .all(Date.now() - maxAgeMs)
      .map(rowToRide);
  }

  // ratings
  insertRating(r) {
    this.db
      .prepare('INSERT INTO ratings (id, ride_id, rater_id, ratee_id, stars, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(r.id, r.rideId, r.raterId, r.rateeId, r.stars, r.comment ?? null, r.createdAt);
  }
  ratingByRideAndRater(rideId, raterId) {
    const row = this.db.prepare('SELECT * FROM ratings WHERE ride_id = ? AND rater_id = ?').get(rideId, raterId);
    return row ? { id: row.id, rideId: row.ride_id, raterId: row.rater_id, rateeId: row.ratee_id, stars: Number(row.stars), comment: row.comment, createdAt: Number(row.created_at) } : null;
  }
  ratingSummary(uid) {
    const row = this.db.prepare('SELECT AVG(stars) AS avg, COUNT(*) AS n FROM ratings WHERE ratee_id = ?').get(uid);
    return { avg: row && row.n ? Math.round(Number(row.avg) * 100) / 100 : null, count: row ? Number(row.n) : 0 };
  }
  ratingComments(uid, limit = 5) {
    return this.db
      .prepare(
        `SELECT stars, comment, created_at FROM ratings
         WHERE ratee_id = ? AND comment IS NOT NULL AND comment != ''
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(uid, limit)
      .map((r) => ({ stars: Number(r.stars), comment: r.comment, createdAt: Number(r.created_at) }));
  }
}

function safeParse(v) {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function rowToUser(row) {
  if (!row) return null;
  let places = null;
  try {
    places = row.places ? JSON.parse(row.places) : null;
  } catch {}
  return {
    id: row.id,
    phone: row.phone,
    passwordHash: row.password_hash,
    name: row.name,
    createdAt: Number(row.created_at),
    verified: !!Number(row.verified),
    otpCode: row.otp_code ?? null,
    otpExpires: row.otp_expires == null ? null : Number(row.otp_expires),
    otpSentAt: row.otp_sent_at == null ? null : Number(row.otp_sent_at),
    avatar: row.avatar ?? null,
    about: row.about ?? null,
    email: row.email ?? null,
    city: row.city ?? null,
    points: row.points != null ? Number(row.points) : 0,
    otpAttempts: row.otp_attempts != null ? Number(row.otp_attempts) : 0,
    banned: !!row.banned,
    places,
  };
}
function rowToDriver(row) {
  return row
    ? { userId: row.user_id, carMake: row.car_make, carModel: row.car_model, carColor: row.car_color, plate: row.plate, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }
    : null;
}
function rowToRide(row) {
  if (!row) return null;
  const parse = (v) => {
    try {
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  };
  return {
    id: row.id, riderId: row.rider_id, driverId: row.driver_id, status: row.status,
    pickupLat: row.pickup_lat, pickupLng: row.pickup_lng, pickupAddress: row.pickup_address,
    destLat: row.dest_lat, destLng: row.dest_lng, destAddress: row.dest_address,
    comment: row.comment, distanceM: row.distance_m, durationS: row.duration_s,
    createdAt: num(row.created_at), acceptedAt: num(row.accepted_at), arrivedAt: num(row.arrived_at),
    startedAt: num(row.started_at), finishedAt: num(row.finished_at), cancelledAt: num(row.cancelled_at),
    cancelledBy: row.cancelled_by,
    pickupDetails: parse(row.pickup_details),
    destDetails: parse(row.dest_details),
  };
}
const num = (v) => (v == null ? null : Number(v));

// ------------------------------------------------------------- JSON file ---

class JsonBackend {
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'drivepro.json');
    this.data = { users: [], driverProfiles: [], rides: [], ratings: [] };
    if (fs.existsSync(this.file)) {
      try {
        this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
      } catch {
        // corrupted file: start fresh but keep a backup
        fs.copyFileSync(this.file, `${this.file}.bak-${Date.now()}`);
      }
    }
  }
  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  insertUser(u) {
    if (this.data.users.some((x) => x.phone === u.phone)) {
      const err = new Error('UNIQUE constraint failed: users.phone');
      throw err;
    }
    this.data.users.push({ ...u });
    this.save();
  }
  userByPhone(phone) {
    return this.data.users.find((u) => u.phone === phone) || null;
  }
  userById(uid) {
    return this.data.users.find((u) => u.id === uid) || null;
  }
  updateUserFields(uid, patch) {
    const u = this.userById(uid);
    if (u) {
      const allowed = ['name', 'verified', 'otpCode', 'otpExpires', 'otpSentAt', 'avatar', 'about', 'email', 'city', 'places', 'otpAttempts', 'banned'];
      for (const k of allowed) {
        if (k in patch) u[k] = patch[k];
      }
      this.save();
    }
  }
  addPoints(uid, n) {
    const u = this.userById(uid);
    if (u) {
      u.points = (u.points || 0) + n;
      this.save();
    }
  }

  _trails() {
    if (!Array.isArray(this.data.trails)) this.data.trails = [];
    return this.data.trails;
  }
  putTrail(rideId, pointsJson, createdAt) {
    const trails = this._trails().filter((t) => t.rideId !== rideId && t.createdAt >= createdAt - 48 * 3600 * 1000);
    trails.push({ rideId, points: pointsJson, createdAt, finishedAt: null });
    this.data.trails = trails;
    this.save();
  }
  finishTrail(rideId, ts) {
    const t = this._trails().find((x) => x.rideId === rideId);
    if (t) {
      t.finishedAt = ts;
      this.save();
    }
  }
  listTrails(sinceMs, limit) {
    return this._trails()
      .filter((t) => t.finishedAt != null && t.finishedAt >= sinceMs)
      .sort((a, b) => b.finishedAt - a.finishedAt)
      .slice(0, limit)
      .map((t) => ({ points: safeParse(t.points), finishedAt: t.finishedAt }))
      .filter((t) => Array.isArray(t.points) && t.points.length >= 2);
  }
  finishedRidesSince(sinceMs) {
    return this.data.rides.filter((r) => r.status === 'finished' && (r.finishedAt || 0) >= sinceMs);
  }

  upsertDriver(p) {
    const existing = this.data.driverProfiles.find((d) => d.userId === p.userId);
    if (existing) Object.assign(existing, p, { createdAt: existing.createdAt });
    else this.data.driverProfiles.push({ ...p });
    this.save();
  }
  driverByUserId(uid) {
    return this.data.driverProfiles.find((d) => d.userId === uid) || null;
  }

  insertRide(r) {
    this.data.rides.push({ ...r });
    this.save();
  }
  rideById(rid) {
    return this.data.rides.find((r) => r.id === rid) || null;
  }
  updateRide(rid, patch) {
    const r = this.rideById(rid);
    if (r) {
      Object.assign(r, patch);
      this.save();
    }
  }
  activeRideForUser(uid) {
    return (
      [...this.data.rides]
        .sort((a, b) => b.createdAt - a.createdAt)
        .find((r) => (r.riderId === uid || r.driverId === uid) && ACTIVE_RIDE_STATUSES.includes(r.status)) || null
    );
  }
  activeRideAsRider(uid) {
    return (
      [...this.data.rides]
        .sort((a, b) => b.createdAt - a.createdAt)
        .find((r) => r.riderId === uid && ACTIVE_RIDE_STATUSES.includes(r.status)) || null
    );
  }
  activeRidesAsDriver(uid) {
    return this.data.rides
      .filter((r) => r.driverId === uid && ACTIVE_RIDE_STATUSES.includes(r.status))
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  allActiveRides() {
    return this.data.rides.filter((r) => ACTIVE_RIDE_STATUSES.includes(r.status));
  }
  allUsers(limit = 300) {
    return [...this.data.users].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  _blocks() {
    if (!Array.isArray(this.data.blocks)) this.data.blocks = [];
    return this.data.blocks;
  }
  _reports() {
    if (!Array.isArray(this.data.reports)) this.data.reports = [];
    return this.data.reports;
  }
  _shares() {
    if (!Array.isArray(this.data.shares)) this.data.shares = [];
    return this.data.shares;
  }
  putBlock(a, b, ts) {
    if (!this._blocks().some((x) => x.a === a && x.b === b)) {
      this._blocks().push({ a, b, ts });
      this.save();
    }
  }
  dropBlock(a, b) {
    this.data.blocks = this._blocks().filter((x) => !(x.a === a && x.b === b));
    this.save();
  }
  blockedEither(a, b) {
    return this._blocks().some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  }
  blockedBy(a) {
    return this._blocks().filter((x) => x.a === a).map((x) => x.b);
  }
  putReport(r) {
    this._reports().push(r);
    this.save();
  }
  allReports(limit = 100) {
    return [...this._reports()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
  putShare(shareId, rideId, ts) {
    if (!this._shares().some((x) => x.rideId === rideId)) {
      this._shares().push({ shareId, rideId, ts });
      this.save();
    }
  }
  shareByRide(rideId) {
    const x = this._shares().find((s) => s.rideId === rideId);
    return x ? x.shareId : null;
  }
  rideByShare(shareId) {
    const x = this._shares().find((s) => s.shareId === shareId);
    return x ? x.rideId : null;
  }
  ridesForUser(uid, limit = 50) {
    return [...this.data.rides]
      .filter((r) => r.riderId === uid || r.driverId === uid)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
  countFinishedRides(uid) {
    return this.data.rides.filter((r) => r.status === 'finished' && (r.riderId === uid || r.driverId === uid)).length;
  }
  requestedRides(maxAgeMs) {
    const cutoff = Date.now() - maxAgeMs;
    return [...this.data.rides]
      .filter((r) => r.status === 'requested' && r.createdAt > cutoff)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  insertRating(r) {
    if (this.data.ratings.some((x) => x.rideId === r.rideId && x.raterId === r.raterId)) {
      throw new Error('UNIQUE constraint failed: ratings');
    }
    this.data.ratings.push({ ...r });
    this.save();
  }
  ratingByRideAndRater(rideId, raterId) {
    return this.data.ratings.find((x) => x.rideId === rideId && x.raterId === raterId) || null;
  }
  ratingSummary(uid) {
    const rs = this.data.ratings.filter((x) => x.rateeId === uid);
    if (!rs.length) return { avg: null, count: 0 };
    const avg = rs.reduce((s, x) => s + x.stars, 0) / rs.length;
    return { avg: Math.round(avg * 100) / 100, count: rs.length };
  }
  ratingComments(uid, limit = 5) {
    return this.data.ratings
      .filter((x) => x.rateeId === uid && x.comment)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((r) => ({ stars: r.stars, comment: r.comment, createdAt: r.createdAt }));
  }
}

// ------------------------------------------------------------ Repository ---

export class Store {
  constructor(dataDir) {
    const sqlite = loadSqlite();
    this.backendName = sqlite ? 'sqlite' : 'json';
    this.b = sqlite ? new SqliteBackend(dataDir, sqlite) : new JsonBackend(dataDir);
  }

  createUser({ phone, passwordHash, name, verified = false, otpCode = null, otpExpires = null, otpSentAt = null }) {
    const u = { id: id(), phone, passwordHash, name, createdAt: now(), verified, otpCode, otpExpires, otpSentAt };
    this.b.insertUser(u);
    return u;
  }
  findUserByPhone(phone) {
    return this.b.userByPhone(phone);
  }
  getUser(uid) {
    return this.b.userById(uid);
  }
  updateUser(uid, patch) {
    this.b.updateUserFields(uid, patch);
    return this.getUser(uid);
  }
  addPoints(uid, n) {
    if (Number.isFinite(n) && n > 0) this.b.addPoints(uid, Math.round(n));
    return this.getUser(uid);
  }

  saveTrail(rideId, points) {
    if (!Array.isArray(points) || points.length < 2) return;
    this.b.putTrail(rideId, JSON.stringify(points), now());
  }
  finishTrail(rideId, ts) {
    this.b.finishTrail(rideId, ts);
  }
  listTrails(hours = 24, limit = 200) {
    return this.b.listTrails(now() - hours * 3600 * 1000, limit);
  }

  listFinishedSince(sinceMs) {
    return this.b.finishedRidesSince(sinceMs);
  }

  upsertDriverProfile(userId, { carMake, carModel, carColor, plate }) {
    const existing = this.b.driverByUserId(userId);
    this.b.upsertDriver({
      userId, carMake, carModel, carColor, plate,
      createdAt: existing ? existing.createdAt : now(),
      updatedAt: now(),
    });
    return this.b.driverByUserId(userId);
  }
  getDriverProfile(userId) {
    return this.b.driverByUserId(userId);
  }

  createRide(fields) {
    const r = { id: id(), status: 'requested', createdAt: now(), ...fields };
    this.b.insertRide(r);
    return r;
  }
  getRide(rid) {
    return this.b.rideById(rid);
  }
  updateRide(rid, patch) {
    this.b.updateRide(rid, patch);
    return this.getRide(rid);
  }
  findActiveRideForUser(uid) {
    return this.b.activeRideForUser(uid);
  }
  findActiveRideAsRider(uid) {
    return this.b.activeRideAsRider(uid);
  }
  listActiveRidesForDriver(uid) {
    return this.b.activeRidesAsDriver(uid);
  }
  listAllActiveRides() {
    return this.b.allActiveRides();
  }
  listUsers(limit) {
    return this.b.allUsers(limit);
  }

  block(a, b) {
    this.b.putBlock(a, b, now());
  }
  unblock(a, b) {
    this.b.dropBlock(a, b);
  }
  isBlockedEither(a, b) {
    if (!a || !b) return false;
    return this.b.blockedEither(a, b);
  }
  listBlockedIds(a) {
    return this.b.blockedBy(a);
  }
  addReport({ reporterId, reportedId, rideId = null, reason = null }) {
    const r = { id: id(), reporterId, reportedId, rideId, reason, createdAt: now() };
    this.b.putReport(r);
    return r;
  }
  listReports(limit = 100) {
    return this.b.allReports(limit);
  }
  shareForRide(rideId) {
    let sid = this.b.shareByRide(rideId);
    if (!sid) {
      sid = id().replace(/-/g, '').slice(0, 20);
      this.b.putShare(sid, rideId, now());
    }
    return sid;
  }
  rideIdByShare(shareId) {
    return this.b.rideByShare(shareId);
  }
  listRidesForUser(uid, limit) {
    return this.b.ridesForUser(uid, limit);
  }
  countFinishedRides(uid) {
    return this.b.countFinishedRides(uid);
  }
  listRequestedRides(maxAgeMs = 30 * 60 * 1000) {
    return this.b.requestedRides(maxAgeMs);
  }

  addRating({ rideId, raterId, rateeId, stars, comment }) {
    const r = { id: id(), rideId, raterId, rateeId, stars, comment: comment || null, createdAt: now() };
    this.b.insertRating(r);
    return r;
  }
  getRatingByRideAndRater(rideId, raterId) {
    return this.b.ratingByRideAndRater(rideId, raterId);
  }
  ratingSummary(uid) {
    return this.b.ratingSummary(uid);
  }
  ratingComments(uid, limit) {
    return this.b.ratingComments(uid, limit);
  }
}
