import { haversineMeters } from './util.js';
import { offerToDrivers } from './rides.js';
import { pushToUser } from './push.js';
import { dayKey } from './streaks.js';

// Scheduled & recurring rides (L14): a commuter saves a route + departure
// time (one-off date or weekly days), and the sweeper turns it into a normal
// ride request shortly before departure - matching then works as usual.
// Times are server-local, like streaks. A ride is spawned once per day, only
// while the rider has no other active ride; unmatched spawns are closed by
// the regular stale-ride sweep.

const SWEEP_MS = Number(process.env.DRIVEPRO_SCHED_SWEEP_MS || 30_000);
const LEAD_MS = Number(process.env.DRIVEPRO_SCHED_LEAD_MS || 10 * 60 * 1000);
const GRACE_MS = Number(process.env.DRIVEPRO_SCHED_GRACE_MS || 30 * 60 * 1000);

// ISO weekday, server-local: 1 = Monday .. 7 = Sunday.
export function isoDow(ts) {
  const d = new Date(ts).getDay();
  return d === 0 ? 7 : d;
}

function targetTsFor(sched, nowMs) {
  const [hh, mm] = String(sched.time).split(':').map(Number);
  const d = new Date(nowMs);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

// Due = right day, inside [T - lead, T + grace], not yet spawned today.
// (A departure within `lead` of midnight is only picked up on its own day.)
export function scheduleDue(sched, nowMs, { leadMs = LEAD_MS, graceMs = GRACE_MS } = {}) {
  if (!sched.active) return false;
  const today = dayKey(nowMs);
  if (sched.lastSpawnDay === today) return false;
  if (sched.date) {
    if (sched.date !== today) return false;
  } else if (!(Array.isArray(sched.days) && sched.days.includes(isoDow(nowMs)))) {
    return false;
  }
  const target = targetTsFor(sched, nowMs);
  return nowMs >= target - leadMs && nowMs <= target + graceMs;
}

export function sweepSchedules(store, hub, nowMs = Date.now()) {
  let spawned = 0;
  for (const sched of store.listActiveSchedules()) {
    if (!scheduleDue(sched, nowMs)) continue;
    const user = store.getUser(sched.riderId);
    if (!user || user.banned) continue;
    // Busy right now? Leave it unmarked - the sweeper retries while the
    // window is open, so finishing another ride still gets you your commute.
    if (store.findActiveRideForUser(sched.riderId)) continue;

    const ride = store.createRide({
      riderId: sched.riderId,
      driverId: null,
      pickupLat: sched.pickupLat,
      pickupLng: sched.pickupLng,
      pickupAddress: sched.pickupAddress,
      pickupDetails: null,
      destLat: sched.destLat,
      destLng: sched.destLng,
      destAddress: sched.destAddress,
      destDetails: null,
      comment: sched.comment || null,
      distanceM: haversineMeters(sched.pickupLat, sched.pickupLng, sched.destLat, sched.destLng),
      durationS: null,
    });
    store.saveTrail(ride.id, [
      [sched.pickupLat, sched.pickupLng],
      [sched.destLat, sched.destLng],
    ]);
    store.updateSchedule(
      sched.id,
      sched.date ? { lastSpawnDay: dayKey(nowMs), active: false } : { lastSpawnDay: dayKey(nowMs) }
    );
    spawned++;
    hub.sendTo(sched.riderId, { type: 'ride:created', ride, scheduled: true });
    pushToUser(store, sched.riderId, {
      title: '⏰ Поездка по расписанию',
      body: `Ищем водителя: ${sched.pickupAddress || ''} → ${sched.destAddress || ''}`,
      tag: `sched-${sched.id}`,
      url: '/',
    });
    offerToDrivers(store, hub, ride);
  }
  return spawned;
}

export function setupSchedules({ store, hub }) {
  const iv = setInterval(() => {
    try {
      sweepSchedules(store, hub);
    } catch (e) {
      console.error('schedule sweep error:', e);
    }
  }, SWEEP_MS);
  if (iv.unref) iv.unref();
}
