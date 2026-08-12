import { httpError, isFiniteNum } from './util.js';

// Geocoding and routing proxy. The app never talks to OpenStreetMap services
// directly - requests go through here so we can set a proper User-Agent,
// cache results and swap providers later without touching the app.

const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
// Optional comma-separated ISO codes to limit search results, e.g. 'kz,ru'.
const COUNTRIES = (process.env.DRIVEPRO_COUNTRIES || '').trim().toLowerCase();

// One OSRM endpoint per travel profile. A self-hosted deploy runs three
// instances (see deploy/setup-osrm.sh) and sets these env vars; the FOSSGIS
// demo servers - which, unlike the plain OSRM demo, actually serve car, foot
// AND bike - are both the default when nothing is configured and the
// per-request fallback when the configured server cannot answer. The
// self-hosted graphs cover one region (Kazakhstan), so a request from
// anywhere else must fail over to the worldwide servers, not error out.
// OSRM_FALLBACK_URL is a test seam: it points all three fallbacks at one
// stub, the same way TWILIO_API_URL keeps smoke26 off the real network.
const FALLBACK_OVERRIDE = process.env.OSRM_FALLBACK_URL || null;
const FOSSGIS = {
  car: FALLBACK_OVERRIDE || 'https://routing.openstreetmap.de/routed-car',
  foot: FALLBACK_OVERRIDE || 'https://routing.openstreetmap.de/routed-foot',
  bike: FALLBACK_OVERRIDE || 'https://routing.openstreetmap.de/routed-bike',
};
const OSRM_CAR = process.env.OSRM_URL || FOSSGIS.car;
const OSRM_FOOT = process.env.OSRM_FOOT_URL || FOSSGIS.foot;
const OSRM_BIKE = process.env.OSRM_BIKE_URL || FOSSGIS.bike;

// mode -> { url, osrmProfile }. The path segment after /route/v1/ is fixed to
// the profile each server was built with, so a self-hosted car server still
// wants "driving" in the path even though it only knows cars.
const PROFILES = {
  car: { url: OSRM_CAR, path: 'driving' },
  foot: { url: OSRM_FOOT, path: 'foot' },
  bike: { url: OSRM_BIKE, path: 'bike' },
};

// A request outside the self-hosted graph does not necessarily error: OSRM
// snaps each point to the nearest edge it knows, however far away, and
// happily routes between the snapped points - from Leicester that is a
// confident route through western Kazakhstan. The response reports how far
// each waypoint snapped, so anything beyond this is treated as "the graph
// does not cover you" rather than an answer.
const SNAP_MAX_M = Number(process.env.OSRM_SNAP_MAX_M || 5000);

// When a profile genuinely cannot answer, try the next one rather than giving
// the app nothing - a cycling route to a place with no footpath is a worse
// answer than a walking one, but it is an enormously better answer than the
// straight line the app draws when a route request fails. Which one actually
// replied is reported back, so the UI can say so instead of pretending.
const MODE_FALLBACK = {
  foot: ['bike', 'car'],
  bike: ['foot', 'car'],
  car: ['bike', 'foot'],
};

export const routeModes = () => Object.keys(PROFILES);

// ------------------------------------------------------------ warming ---
//
// The self-hosted routers run with --mmap=1 because the three graphs total
// ~3.3 GB on a machine with 956 MB of RAM. That works, but it means the graph
// lives in the page cache rather than in the process, and the kernel evicts it
// during idle. Measured on the production VM: a cold route took 2.2 s (car),
// 4.1 s (foot) and 6.0 s (bike), while the same routes warm took 1-100 ms.
//
// The app asks for all three profiles at once, so the user waits for the
// slowest of three cold graphs contending for one disk - which is why routes
// "take forever", and why some requests exceeded the timeout and came back to
// the app as a straight line.
//
// One route per profile is not enough, and measuring said so: with a single
// corridor warmed, an unrelated route across the same city still took 2.6 s
// (car) and 5.5 s (foot). mmap caches the pages a query actually reads, and a
// different corridor reads different pages. Warming six corridors spanning the
// city took 5.2 s once, after which three brand-new routes elsewhere in Almaty
// answered in 94 ms, 82 ms and 14 ms - so the working set for a whole city is
// small enough to hold, it just has to be touched.
//
// And it warms one profile, not three. Measured after warming all three: an
// unwarmed route took 4.0 s (car) and 7.4 s (foot) - *worse* than before the
// warmer existed, because 3.3 GB of graphs cannot all live in ~700 MB of page
// cache and warming them evicts each other. Whichever profile the ride flow
// opens on is the only one anybody waits for; the app now asks for that one
// first and fills the others in behind it, so those can afford to be cold.
//
// Override with OSRM_WARM_ROUTES for a deployment in another city: routes are
// separated by "|", the two points of a route by ";", as OSRM writes them.
// OSRM_WARM_MODES takes the profiles worth warming, comma separated.
const SELF_HOSTED = !!(process.env.OSRM_URL || process.env.OSRM_FOOT_URL || process.env.OSRM_BIKE_URL);
const WARM_EVERY_MS = Number(process.env.OSRM_WARM_MS || 120_000);
const WARM_ROUTES = (
  process.env.OSRM_WARM_ROUTES ||
  [
    '76.85,43.20;76.95,43.28',
    '76.88,43.24;76.93,43.26',
    '76.92,43.21;76.97,43.30',
    '76.83,43.26;76.99,43.22',
    '76.90,43.30;76.96,43.19',
    '76.86,43.22;76.94,43.25',
  ].join('|')
)
  .split('|')
  .map((r) => r.trim())
  .filter(Boolean);
const WARM_MODES = (process.env.OSRM_WARM_MODES || 'car')
  .split(',')
  .map((m) => m.trim())
  .filter((m) => PROFILES[m]);

let warmTimer = null;
let warming = false;

export function startRouteWarmer() {
  // Nothing to warm when routing goes to FOSSGIS: those are shared community
  // servers and warming them would be someone else's bandwidth, not ours.
  if (!SELF_HOSTED || process.env.NODE_ENV === 'test' || warmTimer) return false;
  const tick = async () => {
    // A cold sweep takes seconds; never start a second one on top of it.
    if (warming) return;
    warming = true;
    try {
      for (const mode of WARM_MODES) {
        const p = PROFILES[mode];
        if (!p || p.url === FOSSGIS[mode]) continue;
        for (const pair of WARM_ROUTES) {
          try {
            await upstream(`${p.url}/route/v1/${p.path}/${pair}?overview=false`, ROUTE_TIMEOUT_MS);
          } catch {
            // A router that is down is the watchdog's problem, not the warmer's.
          }
        }
      }
    } finally {
      warming = false;
    }
  };
  warmTimer = setInterval(tick, WARM_EVERY_MS);
  if (warmTimer.unref) warmTimer.unref();
  tick();
  return true;
}

// Nominatim's usage policy requires a contactable User-Agent; a generic one
// risks being blocked. Overridable so a real contact can be set in prod.
const USER_AGENT = process.env.GEO_USER_AGENT || 'DrivePro/1.0 (+https://drivepro-almaty.duckdns.org)';
const TIMEOUT_MS = 8000;
// Routing gets longer than geocoding does. A cold memory-mapped graph on this
// VM answers in seconds, not milliseconds - bike was measured at 8.4 s, just
// past the old ceiling, and a route that times out is exactly the failure the
// app used to draw as a straight line across the city. Walking and cycling now
// load behind the opening mode anyway, so a patient ceiling costs nobody
// anything; being cut off half a second early costs a route.
const ROUTE_TIMEOUT_MS = Number(process.env.OSRM_TIMEOUT_MS || 20000);
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;

const cache = new Map(); // key -> { at, value }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

async function upstream(url, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw httpError(502, `map service responded ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e.status) throw e;
    throw httpError(502, 'map service unavailable');
  } finally {
    clearTimeout(timer);
  }
}

function shortAddress(displayName) {
  if (!displayName) return '';
  const parts = String(displayName).split(',').map((s) => s.trim());
  return parts.slice(0, 3).join(', ');
}

function langParam(lang) {
  return lang === 'ru' ? 'ru,en' : 'en,ru';
}

export async function reverseGeocode(lat, lng, lang) {
  if (!isFiniteNum(lat) || !isFiniteNum(lng)) throw httpError(400, 'lat and lng are required');
  const key = `rev:${lat.toFixed(5)},${lng.toFixed(5)}:${lang || ''}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const url = `${NOMINATIM_URL}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0&accept-language=${langParam(lang)}`;
  const json = await upstream(url);
  const value = {
    address: shortAddress(json && json.display_name),
    fullAddress: (json && json.display_name) || '',
  };
  cacheSet(key, value);
  return value;
}

export async function searchAddress(q, lat, lng, lang) {
  const query = String(q || '').trim();
  if (query.length < 2) throw httpError(400, 'query too short');
  const bias =
    isFiniteNum(lat) && isFiniteNum(lng)
      ? `&viewbox=${lng - 0.25},${lat + 0.25},${lng + 0.25},${lat - 0.25}&bounded=0`
      : '';
  const countries = COUNTRIES ? `&countrycodes=${encodeURIComponent(COUNTRIES)}` : '';
  const key = `search:${query.toLowerCase()}:${bias}:${lang || ''}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const url = `${NOMINATIM_URL}/search?format=jsonv2&limit=6&q=${encodeURIComponent(query)}${bias}${countries}&accept-language=${langParam(lang)}`;
  const json = await upstream(url);
  let value = (Array.isArray(json) ? json : []).map((r) => ({
    lat: Number(r.lat),
    lng: Number(r.lon),
    address: shortAddress(r.display_name),
    fullAddress: r.display_name || '',
  }));
  // Nominatim ranks by importance, which is why typing "аптек" in Almaty
  // offered pharmacies in Ulaanbaatar above local ones. This is a navigation
  // app: what is near you matters more than what is famous. Nothing is
  // dropped - somewhere genuinely distant is still reachable - it just sorts
  // below the things you could actually walk to.
  if (isFiniteNum(lat) && isFiniteNum(lng)) {
    const d2 = (r) => {
      const dx = (r.lat - lat) * 111_000;
      const dy = (r.lng - lng) * 111_000 * Math.cos((lat * Math.PI) / 180);
      return dx * dx + dy * dy;
    };
    value = value.slice().sort((a, b) => d2(a) - d2(b));
  }
  cacheSet(key, value);
  return value;
}

export async function route(fromLat, fromLng, toLat, toLng, mode = 'car', withSteps = false, wantAlts = 0) {
  if (![fromLat, fromLng, toLat, toLng].every(isFiniteNum)) {
    throw httpError(400, 'from and to coordinates are required');
  }
  // Resolve to a known mode up front, so the reported mode and the cache key
  // both reflect what actually ran rather than an unknown input.
  const resolved = PROFILES[mode] ? mode : 'car';
  const profile = PROFILES[resolved];
  const key = `route:${resolved}:${withSteps ? 's:' : ''}${wantAlts ? `a${wantAlts}:` : ''}${fromLat.toFixed(5)},${fromLng.toFixed(5)}:${toLat.toFixed(5)},${toLng.toFixed(5)}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  // Ask the configured server first; if it cannot give a usable answer -
  // an error, no route, or waypoints snapped implausibly far because the
  // points lie outside its regional graph - fail over to the worldwide
  // FOSSGIS server for the same profile. When no self-hosted server is
  // configured the two URLs are identical and there is nothing to retry.
  const ask = async (base, path, a, b) => {
    const json = await upstream(
      `${base}/route/v1/${path}/${a.lng},${a.lat};${b.lng},${b.lat}` +
        `?overview=full&geometries=geojson&steps=${withSteps ? 'true' : 'false'}` +
        `&alternatives=${wantAlts > 0 ? wantAlts : 'false'}`,
      ROUTE_TIMEOUT_MS
    );
    if (!json || json.code !== 'Ok' || !json.routes || !json.routes[0]) {
      throw httpError(502, 'no route found');
    }
    if ((json.waypoints || []).some((w) => isFiniteNum(w.distance) && w.distance > SNAP_MAX_M)) {
      throw httpError(502, 'no route found near these points');
    }
    return json;
  };

  const from = { lat: fromLat, lng: fromLng };
  const to = { lat: toLat, lng: toLng };
  const fallback = FOSSGIS[resolved];
  const pathFor = (m) => (m === 'car' ? 'driving' : m);

  // Repair rather than refuse. A point dropped on a building, inside a park or
  // on a motorway a pedestrian cannot use is not a reason to give up: OSRM's
  // nearest service says where the closest point that profile can actually
  // start from is, and routing from there is the answer a person wanted. Where
  // the point moved to is reported, so the app can show it instead of drawing
  // a line to somewhere unreachable.
  const repair = async (base, path, pt) => {
    try {
      const json = await upstream(`${base}/nearest/v1/${path}/${pt.lng},${pt.lat}?number=1`, ROUTE_TIMEOUT_MS);
      const w = json && json.waypoints && json.waypoints[0];
      if (!w || !Array.isArray(w.location) || !isFiniteNum(w.location[0])) return null;
      const moved = Math.round(w.distance || 0);
      // A metre of correction is not worth a second request; the router had
      // already snapped that far by itself.
      if (moved < 5) return null;
      return { lat: w.location[1], lng: w.location[0], movedM: moved };
    } catch {
      return null;
    }
  };

  let json = null;
  let usedMode = resolved;
  let snapped = null;

  const attempt = async (mode) => {
    const p = PROFILES[mode];
    const fb = FOSSGIS[mode];
    // 1. the configured router, as asked
    try {
      return { json: await ask(p.url, p.path, from, to), snapped: null };
    } catch (e) {
      // 2. the same router, from the nearest points it can actually route
      //    between - this is what turns "no route found near these points"
      //    into a real route along a real path
      const [a, b] = await Promise.all([repair(p.url, p.path, from), repair(p.url, p.path, to)]);
      if (a || b) {
        try {
          return {
            json: await ask(p.url, p.path, a || from, b || to),
            snapped: { from: a, to: b },
          };
        } catch {
          // fall through to the worldwide server
        }
      }
      // 3. the worldwide server, for points outside a regional graph
      if (p.url === fb) throw e;
      return { json: await ask(fb, pathFor(mode), from, to), snapped: null };
    }
  };

  try {
    const got = await attempt(resolved);
    json = got.json;
    snapped = got.snapped;
  } catch (first) {
    // 4. another profile, rather than nothing. Reported as viaMode so the app
    //    can say "no walking route here - this is the cycling one" instead of
    //    quietly showing the wrong thing.
    for (const alt of MODE_FALLBACK[resolved] || []) {
      try {
        const got = await attempt(alt);
        json = got.json;
        snapped = got.snapped;
        usedMode = alt;
        break;
      } catch {
        // try the next profile
      }
    }
    if (!json) throw first;
  }
  // GeoJSON is [lng, lat]; the app works in [lat, lng].
  const shape = (x) => ({
    distanceM: Math.round(x.distance),
    durationS: Math.round(x.duration),
    points: (x.geometry && x.geometry.coordinates ? x.geometry.coordinates : []).map((c) => [c[1], c[0]]),
  });
  const r = json.routes[0];
  // `mode` stays what was asked for, so the app's own bookkeeping does not
  // change under it; `viaMode` and `snapped` are the honest footnotes.
  const value = { mode: resolved, ...shape(r) };
  if (usedMode !== resolved) value.viaMode = usedMode;
  if (snapped && (snapped.from || snapped.to)) {
    value.snapped = {};
    if (snapped.from) value.snapped.from = snapped.from;
    if (snapped.to) value.snapped.to = snapped.to;
  }
  // Alternatives, when asked for and when the road network offers any. OSRM
  // returns the primary first, so the extras are everything after it.
  if (wantAlts > 0 && json.routes.length > 1) {
    value.alts = json.routes.slice(1, 1 + wantAlts).map(shape);
  }
  if (withSteps) {
    // Compact turn-by-turn steps for the navigation banner: what to do, where,
    // onto which street, and how far that leg runs. Everything else OSRM
    // returns per step (geometry, intersections, lanes) is dropped - the
    // banner does not need it and the payload stays small.
    value.steps = (r.legs || []).flatMap((leg) =>
      (leg.steps || []).map((s) => ({
        type: s.maneuver && s.maneuver.type ? s.maneuver.type : '',
        mod: s.maneuver && s.maneuver.modifier ? s.maneuver.modifier : null,
        name: s.name || '',
        distM: Math.round(s.distance || 0),
        loc: s.maneuver && s.maneuver.location ? [s.maneuver.location[1], s.maneuver.location[0]] : null,
      }))
    );
  }
  cacheSet(key, value);
  return value;
}
