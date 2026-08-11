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

export const routeModes = () => Object.keys(PROFILES);

// Nominatim's usage policy requires a contactable User-Agent; a generic one
// risks being blocked. Overridable so a real contact can be set in prod.
const USER_AGENT = process.env.GEO_USER_AGENT || 'DrivePro/1.0 (+https://drivepro-almaty.duckdns.org)';
const TIMEOUT_MS = 8000;
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

async function upstream(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
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
  const value = (Array.isArray(json) ? json : []).map((r) => ({
    lat: Number(r.lat),
    lng: Number(r.lon),
    address: shortAddress(r.display_name),
    fullAddress: r.display_name || '',
  }));
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
  const ask = async (base, path) => {
    const json = await upstream(
      `${base}/route/v1/${path}/${fromLng},${fromLat};${toLng},${toLat}` +
        `?overview=full&geometries=geojson&steps=${withSteps ? 'true' : 'false'}` +
        `&alternatives=${wantAlts > 0 ? wantAlts : 'false'}`
    );
    if (!json || json.code !== 'Ok' || !json.routes || !json.routes[0]) {
      throw httpError(502, 'no route found');
    }
    if ((json.waypoints || []).some((w) => isFiniteNum(w.distance) && w.distance > SNAP_MAX_M)) {
      throw httpError(502, 'no route found near these points');
    }
    return json;
  };
  const fallback = FOSSGIS[resolved];
  let json;
  try {
    json = await ask(profile.url, profile.path);
  } catch (e) {
    if (profile.url === fallback) throw e;
    json = await ask(fallback, resolved === 'car' ? 'driving' : resolved);
  }
  // GeoJSON is [lng, lat]; the app works in [lat, lng].
  const shape = (x) => ({
    distanceM: Math.round(x.distance),
    durationS: Math.round(x.duration),
    points: (x.geometry && x.geometry.coordinates ? x.geometry.coordinates : []).map((c) => [c[1], c[0]]),
  });
  const r = json.routes[0];
  const value = { mode: resolved, ...shape(r) };
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
