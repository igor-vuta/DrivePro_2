import { isFiniteNum } from './util.js';
import { publicUser, rideCounterpart } from './views.js';

// Realtime hub: tracks connected users, online (active) drivers and routes
// websocket messages. Ride matching events plug in here in later milestones.

const HEARTBEAT_MS = 30_000;
const DRIVER_GRACE_MS = 60_000; // keep a driver online this long after disconnect
const MAP_PUSH_MS = 3_000; // how often nearby-driver positions are pushed to watching riders
const MAP_RADIUS_M = 15_000;
const MAP_MAX_DRIVERS = 20;

export class Hub {
  constructor(store) {
    this.store = store;
    this.conns = new Map(); // userId -> Set<WsConnection>
    this.drivers = new Map(); // userId -> { lat, lng, updatedAt }
    this.driverDropTimers = new Map(); // userId -> Timeout
    this.mapWatchers = new Map(); // userId -> { lat, lng }
    this.handlers = new Map(); // type -> (user, msg, conn) => void

    this._registerCoreHandlers();

    this.heartbeat = setInterval(() => this._checkHeartbeats(), HEARTBEAT_MS);
    if (this.heartbeat.unref) this.heartbeat.unref();
    this.mapPush = setInterval(() => this._pushMapDrivers(), MAP_PUSH_MS);
    if (this.mapPush.unref) this.mapPush.unref();
  }

  // ------------------------------------------------------------ wiring ---

  attach(conn, user) {
    let set = this.conns.get(user.id);
    if (!set) {
      set = new Set();
      this.conns.set(user.id, set);
    }
    set.add(conn);

    // Reconnected driver: cancel pending drop.
    const t = this.driverDropTimers.get(user.id);
    if (t) {
      clearTimeout(t);
      this.driverDropTimers.delete(user.id);
    }

    conn.onmessage = (text) => {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        conn.send({ type: 'error', message: 'invalid JSON' });
        return;
      }
      if (!msg || typeof msg.type !== 'string') {
        conn.send({ type: 'error', message: 'missing message type' });
        return;
      }
      const handler = this.handlers.get(msg.type);
      if (!handler) {
        conn.send({ type: 'error', message: `unknown message type: ${msg.type}`, reqId: msg.reqId });
        return;
      }
      try {
        handler(user, msg, conn);
      } catch (e) {
        conn.send({ type: 'error', message: e.message || 'internal error', reqId: msg.reqId });
      }
    };

    conn.onclose = () => {
      const s = this.conns.get(user.id);
      if (s) {
        s.delete(conn);
        if (!s.size) {
          this.conns.delete(user.id);
          this.mapWatchers.delete(user.id);
          this._scheduleDriverDrop(user.id);
        }
      }
    };

    const activeRide = this.store.findActiveRideForUser(user.id);
    const driverLoc = activeRide && activeRide.driverId ? this.drivers.get(activeRide.driverId) : null;
    conn.send({
      type: 'hello',
      user: publicUser(this.store, user.id),
      driverActive: this.drivers.has(user.id),
      activeRide,
      counterpart: rideCounterpart(this.store, activeRide, user.id),
      driverLocation: driverLoc ? { lat: driverLoc.lat, lng: driverLoc.lng } : null,
    });

    // Online driver reconnecting: replay any open orders they may have missed.
    if (this.drivers.has(user.id) && this.onDriverReady) this.onDriverReady(user.id, conn);
  }

  on(type, handler) {
    this.handlers.set(type, handler);
  }

  // ----------------------------------------------------------- sending ---

  sendTo(userId, msg) {
    const set = this.conns.get(userId);
    if (!set) return false;
    for (const c of set) c.send(msg);
    return set.size > 0;
  }

  onlineDriverIds() {
    return [...this.drivers.keys()];
  }

  driverLocation(userId) {
    return this.drivers.get(userId) || null;
  }

  isOnline(userId) {
    return this.conns.has(userId);
  }

  // ------------------------------------------------------ core handlers ---

  _registerCoreHandlers() {
    this.on('ping', (user, msg, conn) => conn.send({ type: 'pong', reqId: msg.reqId }));

    this.on('driver:activate', (user, msg, conn) => {
      const profile = this.store.getDriverProfile(user.id);
      if (!profile) {
        conn.send({ type: 'error', message: 'Fill in your car details before going online.', reqId: msg.reqId });
        return;
      }
      if (!isFiniteNum(msg.lat) || !isFiniteNum(msg.lng)) {
        conn.send({ type: 'error', message: 'Location is required to go online.', reqId: msg.reqId });
        return;
      }
      this.drivers.set(user.id, { lat: msg.lat, lng: msg.lng, updatedAt: Date.now() });
      conn.send({ type: 'driver:status', active: true, reqId: msg.reqId });
      if (this.onDriverReady) this.onDriverReady(user.id, conn);
    });

    this.on('driver:deactivate', (user, msg, conn) => {
      this.drivers.delete(user.id);
      conn.send({ type: 'driver:status', active: false, reqId: msg.reqId });
    });

    this.on('driver:location', (user, msg) => {
      if (!isFiniteNum(msg.lat) || !isFiniteNum(msg.lng)) return;
      const d = this.drivers.get(user.id);
      if (d) {
        d.lat = msg.lat;
        d.lng = msg.lng;
        d.updatedAt = Date.now();
      }
      // During an active ride the location is also relayed to the rider
      // (wired up in the ride module).
      if (this.onDriverLocation) this.onDriverLocation(user.id, msg.lat, msg.lng);
    });

    // Riders watching the map get periodic nearby-driver positions.
    this.on('map:watch', (user, msg) => {
      if (!isFiniteNum(msg.lat) || !isFiniteNum(msg.lng)) return;
      this.mapWatchers.set(user.id, { lat: msg.lat, lng: msg.lng });
      this._pushMapDriversTo(user.id);
    });

    this.on('map:unwatch', (user) => {
      this.mapWatchers.delete(user.id);
    });
  }

  // --------------------------------------------------------- internals ---

  _scheduleDriverDrop(userId) {
    if (!this.drivers.has(userId)) return;
    const t = setTimeout(() => {
      this.driverDropTimers.delete(userId);
      if (!this.conns.has(userId)) {
        this.drivers.delete(userId);
      }
    }, DRIVER_GRACE_MS);
    if (t.unref) t.unref();
    this.driverDropTimers.set(userId, t);
  }

  _pushMapDrivers() {
    for (const userId of this.mapWatchers.keys()) this._pushMapDriversTo(userId);
  }

  _pushMapDriversTo(userId) {
    const watch = this.mapWatchers.get(userId);
    if (!watch) return;
    const list = [];
    for (const [driverId, loc] of this.drivers) {
      if (driverId === userId) continue;
      const dx = (loc.lat - watch.lat) * 111_000;
      const dy = (loc.lng - watch.lng) * 111_000 * Math.cos((watch.lat * Math.PI) / 180);
      if (dx * dx + dy * dy > MAP_RADIUS_M * MAP_RADIUS_M) continue;
      list.push({ id: driverId, lat: loc.lat, lng: loc.lng });
      if (list.length >= MAP_MAX_DRIVERS) break;
    }
    this.sendTo(userId, { type: 'map:drivers', drivers: list });
  }

  _checkHeartbeats() {
    for (const set of this.conns.values()) {
      for (const conn of set) {
        if (!conn.isAlive) {
          conn.terminate();
        } else {
          conn.isAlive = false;
          conn.ping();
        }
      }
    }
  }
}

