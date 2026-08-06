import { isFiniteNum, isLat, isLng, cleanStr, cleanAddressDetails, haversineMeters, pointToPolyline } from './util.js';
import { publicUser, rideCounterpart } from './views.js';

// Ride lifecycle over websocket messages. This module registers the
// rider-side handlers (request/cancel) and pushes offers to online drivers.
// Driver-side accept/arrive/start/finish arrive in the next milestones.

const CANCELLABLE = ['requested', 'accepted', 'arrived'];
const MAX_CONVOY = 3; // passengers a driver may carry at once

// Zombie protection: rides abandoned in an active status get closed
// automatically. Cutoffs are env-tunable (tests use tiny values).
const STALE_MS = {
  requested: Number(process.env.DRIVEPRO_STALE_REQUESTED_MS || 30 * 60 * 1000),
  accepted: Number(process.env.DRIVEPRO_STALE_ACCEPTED_MS || 3 * 3600 * 1000),
  arrived: Number(process.env.DRIVEPRO_STALE_ACCEPTED_MS || 3 * 3600 * 1000),
  in_progress: Number(process.env.DRIVEPRO_STALE_TRIP_MS || 12 * 3600 * 1000),
};
const SWEEP_EVERY_MS = Number(process.env.DRIVEPRO_SWEEP_MS || 5 * 60 * 1000);

export function sweepStaleRides(store, hub, nowMs = Date.now()) {
  let closed = 0;
  for (const ride of store.listAllActiveRides()) {
    const started = ride.status === 'requested' ? ride.createdAt : ride.acceptedAt || ride.createdAt;
    const age = nowMs - (ride.status === 'in_progress' ? ride.startedAt || started : started);
    if (age < (STALE_MS[ride.status] || Infinity)) continue;
    const updated = store.updateRide(ride.id, { status: 'cancelled', cancelledAt: nowMs, cancelledBy: 'system' });
    closed++;
    for (const uid of [updated.riderId, updated.driverId]) {
      if (uid) hub.sendTo(uid, { type: 'ride:cancelled', ride: updated });
    }
    for (const did of hub.onlineDriverIds()) hub.sendTo(did, { type: 'ride:offer_gone', rideId: updated.id });
  }
  return closed;
}

export function setupRides({ store, hub }) {
  const sweep = setInterval(() => sweepStaleRides(store, hub), SWEEP_EVERY_MS);
  if (sweep.unref) sweep.unref();

  // Rider requests a ride.
  hub.on('ride:request', (user, msg, conn) => {
    const existing = store.findActiveRideForUser(user.id);
    if (existing) {
      conn.send({ type: 'error', message: 'You already have an active ride.', reqId: msg.reqId });
      return;
    }
    const p = msg.pickup || {};
    const d = msg.dest || {};
    if (!isLat(p.lat) || !isLng(p.lng) || !isLat(d.lat) || !isLng(d.lng)) {
      conn.send({ type: 'error', code: 'points_required', message: 'Pickup and destination are required.', reqId: msg.reqId });
      return;
    }
    const distanceM =
      isFiniteNum(msg.distanceM) && msg.distanceM > 0
        ? Math.round(msg.distanceM)
        : haversineMeters(p.lat, p.lng, d.lat, d.lng);
    const durationS = isFiniteNum(msg.durationS) && msg.durationS > 0 ? Math.round(msg.durationS) : null;

    // Trail geometry: the route the rider previewed, or a straight line.
    const routePoints = (Array.isArray(msg.routePoints) ? msg.routePoints : [])
      .filter((pt) => Array.isArray(pt) && isLat(Number(pt[0])) && isLng(Number(pt[1])))
      .slice(0, 200)
      .map((pt) => [Number(pt[0]), Number(pt[1])]);

    const ride = store.createRide({
      riderId: user.id,
      driverId: null,
      pickupLat: p.lat,
      pickupLng: p.lng,
      pickupAddress: cleanStr(p.address, 200),
      pickupDetails: cleanAddressDetails(p.details),
      destLat: d.lat,
      destLng: d.lng,
      destAddress: cleanStr(d.address, 200),
      destDetails: cleanAddressDetails(d.details),
      comment: cleanStr(msg.comment, 300),
      distanceM,
      durationS,
    });

    store.saveTrail(ride.id, routePoints.length >= 2 ? routePoints : [[p.lat, p.lng], [d.lat, d.lng]]);
    conn.send({ type: 'ride:created', ride, reqId: msg.reqId });
    offerToDrivers(store, hub, ride);
  });

  // Driver accepts an open order - first accept wins.
  hub.on('ride:accept', (user, msg, conn) => {
    if (!store.getDriverProfile(user.id)) {
      conn.send({ type: 'error', message: 'Only drivers can accept orders.', reqId: msg.reqId });
      return;
    }
    const ride = msg.rideId ? store.getRide(msg.rideId) : null;
    if (!ride || ride.status !== 'requested' || ride.driverId) {
      conn.send({ type: 'error', code: 'taken', message: 'This order is no longer available.', reqId: msg.reqId });
      hub.sendTo(user.id, { type: 'ride:offer_gone', rideId: msg.rideId });
      return;
    }
    if (ride.riderId === user.id) {
      conn.send({ type: 'error', message: "You can't take your own order.", reqId: msg.reqId });
      return;
    }
    if (store.findActiveRideAsRider(user.id)) {
      conn.send({ type: 'error', message: 'Finish your current ride first.', reqId: msg.reqId });
      return;
    }
    if (store.listActiveRidesForDriver(user.id).length >= MAX_CONVOY) {
      conn.send({ type: 'error', code: 'convoy_full', message: `You already carry ${MAX_CONVOY} passengers.`, reqId: msg.reqId });
      return;
    }

    const updated = store.updateRide(ride.id, {
      driverId: user.id,
      status: 'accepted',
      acceptedAt: Date.now(),
    });
    const loc = hub.driverLocation(user.id);
    const driverLocation = loc ? { lat: loc.lat, lng: loc.lng } : null;

    hub.sendTo(updated.riderId, {
      type: 'ride:update',
      ride: updated,
      counterpart: rideCounterpart(store, updated, updated.riderId),
      driverLocation,
    });
    hub.sendTo(user.id, {
      type: 'ride:update',
      ride: updated,
      counterpart: rideCounterpart(store, updated, user.id),
      reqId: msg.reqId,
    });
    for (const did of hub.onlineDriverIds()) {
      if (did !== user.id) hub.sendTo(did, { type: 'ride:offer_gone', rideId: updated.id });
    }
  });

  // Driver-only status transitions: accepted -> arrived -> in_progress -> finished.
  // (Starting straight from "accepted" is allowed in case the driver forgets
  // to tap "arrived".)
  const transition = (type, fromStatuses, toStatus, stampField) => {
    hub.on(type, (user, msg, conn) => {
      const ride = msg.rideId ? store.getRide(msg.rideId) : store.findActiveRideForUser(user.id);
      if (!ride || ride.driverId !== user.id) {
        conn.send({ type: 'error', message: 'No such ride.', reqId: msg.reqId });
        return;
      }
      if (!fromStatuses.includes(ride.status)) {
        conn.send({ type: 'error', message: `Can't do that from status "${ride.status}".`, reqId: msg.reqId });
        return;
      }
      const updated = store.updateRide(ride.id, { status: toStatus, [stampField]: Date.now() });
      hub.sendTo(updated.riderId, { type: 'ride:update', ride: updated });
      hub.sendTo(updated.driverId, { type: 'ride:update', ride: updated, reqId: msg.reqId });
    });
  };
  transition('ride:arrived', ['accepted'], 'arrived', 'arrivedAt');
  transition('ride:start', ['accepted', 'arrived'], 'in_progress', 'startedAt');

  // Finishing is special: the driver earns points = distance (km) x trip time
  // (minutes), minimum 1 per completed ride.
  hub.on('ride:finish', (user, msg, conn) => {
    const ride = msg.rideId ? store.getRide(msg.rideId) : store.findActiveRideForUser(user.id);
    if (!ride || ride.driverId !== user.id) {
      conn.send({ type: 'error', message: 'No such ride.', reqId: msg.reqId });
      return;
    }
    if (ride.status !== 'in_progress') {
      conn.send({ type: 'error', message: `Can't do that from status "${ride.status}".`, reqId: msg.reqId });
      return;
    }
    const finishedAt = Date.now();
    const updated = store.updateRide(ride.id, { status: 'finished', finishedAt });
    const km = (updated.distanceM || 0) / 1000;
    const minutes = Math.max(1, (finishedAt - (updated.startedAt || finishedAt)) / 60000);
    const pointsEarned = Math.max(1, Math.min(5000, Math.round(km * minutes)));
    store.addPoints(user.id, pointsEarned);
    store.finishTrail(updated.id, finishedAt);
    store.addPoints(updated.riderId, 1); // riders climb too, slowly
    hub.sendTo(updated.riderId, { type: 'ride:update', ride: updated });
    hub.sendTo(updated.driverId, { type: 'ride:update', ride: updated, pointsEarned, reqId: msg.reqId });
  });

  // While a ride is active, relay the driver's live position to the rider.
  hub.onDriverLocation = (driverId, lat, lng) => {
    const ride = store.findActiveRideForUser(driverId);
    if (ride && ride.driverId === driverId) {
      hub.sendTo(ride.riderId, { type: 'ride:driver_location', rideId: ride.id, lat, lng });
    }
  };

  // A driver who goes online (or reconnects while online) receives every
  // still-open order, so orders created while they were away aren't lost.
  hub.onDriverReady = (driverId, conn) => {
    if (store.findActiveRideAsRider(driverId)) return;
    if (store.listActiveRidesForDriver(driverId).length >= MAX_CONVOY) return;
    const loc = hub.driverLocation(driverId);
    for (const ride of store.listRequestedRides()) {
      if (ride.riderId === driverId) continue;
      if (!fitsDriverRoute(loc, ride)) continue;
      const rider = publicUser(store, ride.riderId);
      if (rider) {
        delete rider.phone;
        delete rider.email;
        delete rider.places;
      }
      const pickupDistanceM = loc ? haversineMeters(loc.lat, loc.lng, ride.pickupLat, ride.pickupLng) : null;
      conn.send({ type: 'ride:offer', ride, rider, pickupDistanceM });
    }
  };

  // Either side cancels (rider in this milestone; driver too once matched).
  hub.on('ride:cancel', (user, msg, conn) => {
    const ride = msg.rideId ? store.getRide(msg.rideId) : store.findActiveRideForUser(user.id);
    if (!ride || (ride.riderId !== user.id && ride.driverId !== user.id)) {
      conn.send({ type: 'error', message: 'No such ride.', reqId: msg.reqId });
      return;
    }
    if (!CANCELLABLE.includes(ride.status)) {
      conn.send({ type: 'error', message: `This ride can't be cancelled any more.`, reqId: msg.reqId });
      return;
    }
    const updated = store.updateRide(ride.id, {
      status: 'cancelled',
      cancelledAt: Date.now(),
      cancelledBy: ride.riderId === user.id ? 'rider' : 'driver',
    });
    hub.sendTo(updated.riderId, { type: 'ride:cancelled', ride: updated });
    if (updated.driverId) hub.sendTo(updated.driverId, { type: 'ride:cancelled', ride: updated });
    // Tell online drivers the offer is gone from their feed.
    if (!updated.driverId) {
      for (const did of hub.onlineDriverIds()) {
        hub.sendTo(did, { type: 'ride:offer_gone', rideId: updated.id });
      }
    }
  });
}

// Route mode: a ride fits when both its pickup and destination lie inside the
// driver's corridor and follow the direction of travel.
export function fitsDriverRoute(driverEntry, ride) {
  const route = driverEntry && driverEntry.route;
  if (!route) return true;
  const p = pointToPolyline(ride.pickupLat, ride.pickupLng, route.points);
  const d = pointToPolyline(ride.destLat, ride.destLng, route.points);
  if (p.distM > route.radiusM || d.distM > route.radiusM) return false;
  if (d.pos < p.pos - 1e-6) return false;
  // Only the road still ahead: skip pickups the driver has already passed.
  if (isFiniteNum(driverEntry.lat) && isFiniteNum(driverEntry.lng)) {
    const cur = pointToPolyline(driverEntry.lat, driverEntry.lng, route.points);
    if (p.pos < cur.pos - 0.75) return false;
  }
  return true;
}

export function offerToDrivers(store, hub, ride) {
  const rider = publicUser(store, ride.riderId);
  if (rider) {
    delete rider.phone;
    delete rider.email;
    delete rider.places;
  }
  for (const driverId of hub.onlineDriverIds()) {
    if (driverId === ride.riderId) continue;
    if (store.listActiveRidesForDriver(driverId).length >= MAX_CONVOY) continue;
    const loc = hub.driverLocation(driverId);
    if (!fitsDriverRoute(loc, ride)) continue;
    const pickupDistanceM = loc ? haversineMeters(loc.lat, loc.lng, ride.pickupLat, ride.pickupLng) : null;
    hub.sendTo(driverId, { type: 'ride:offer', ride, rider, pickupDistanceM });
  }
}
