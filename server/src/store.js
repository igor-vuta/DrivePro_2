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
        created_at INTEGER NOT NULL
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
        cancelled_by TEXT
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
      CREATE INDEX IF NOT EXISTS idx_rides_rider ON rides (rider_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides (driver_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_ratings_ratee ON ratings (ratee_id);
    `);
  }

  // users
  insertUser(u) {
    this.db
      .prepare('INSERT INTO users (id, phone, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(u.id, u.phone, u.passwordHash, u.name, u.createdAt);
  }
  userByPhone(phone) {
    return rowToUser(this.db.prepare('SELECT * FROM users WHERE phone = ?').get(phone));
  }
  userById(uid) {
    return rowToUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(uid));
  }
  updateUserName(uid, name) {
    this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, uid);
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
          dest_lat, dest_lng, dest_address, comment, distance_m, duration_s, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        r.id, r.riderId, r.driverId ?? null, r.status, r.pickupLat, r.pickupLng, r.pickupAddress ?? null,
        r.destLat ?? null, r.destLng ?? null, r.destAddress ?? null, r.comment ?? null,
        r.distanceM ?? null, r.durationS ?? null, r.createdAt
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
}

function rowToUser(row) {
  return row
    ? { id: row.id, phone: row.phone, passwordHash: row.password_hash, name: row.name, createdAt: Number(row.created_at) }
    : null;
}
function rowToDriver(row) {
  return row
    ? { userId: row.user_id, carMake: row.car_make, carModel: row.car_model, carColor: row.car_color, plate: row.plate, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }
    : null;
}
function rowToRide(row) {
  if (!row) return null;
  return {
    id: row.id, riderId: row.rider_id, driverId: row.driver_id, status: row.status,
    pickupLat: row.pickup_lat, pickupLng: row.pickup_lng, pickupAddress: row.pickup_address,
    destLat: row.dest_lat, destLng: row.dest_lng, destAddress: row.dest_address,
    comment: row.comment, distanceM: row.distance_m, durationS: row.duration_s,
    createdAt: num(row.created_at), acceptedAt: num(row.accepted_at), arrivedAt: num(row.arrived_at),
    startedAt: num(row.started_at), finishedAt: num(row.finished_at), cancelledAt: num(row.cancelled_at),
    cancelledBy: row.cancelled_by,
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
  updateUserName(uid, name) {
    const u = this.userById(uid);
    if (u) {
      u.name = name;
      this.save();
    }
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
  ridesForUser(uid, limit = 50) {
    return [...this.data.rides]
      .filter((r) => r.riderId === uid || r.driverId === uid)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
  countFinishedRides(uid) {
    return this.data.rides.filter((r) => r.status === 'finished' && (r.riderId === uid || r.driverId === uid)).length;
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
}

// ------------------------------------------------------------ Repository ---

export class Store {
  constructor(dataDir) {
    const sqlite = loadSqlite();
    this.backendName = sqlite ? 'sqlite' : 'json';
    this.b = sqlite ? new SqliteBackend(dataDir, sqlite) : new JsonBackend(dataDir);
  }

  createUser({ phone, passwordHash, name }) {
    const u = { id: id(), phone, passwordHash, name, createdAt: now() };
    this.b.insertUser(u);
    return u;
  }
  findUserByPhone(phone) {
    return this.b.userByPhone(phone);
  }
  getUser(uid) {
    return this.b.userById(uid);
  }
  updateUserName(uid, name) {
    this.b.updateUserName(uid, name);
    return this.getUser(uid);
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
  listRidesForUser(uid, limit) {
    return this.b.ridesForUser(uid, limit);
  }
  countFinishedRides(uid) {
    return this.b.countFinishedRides(uid);
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
}
