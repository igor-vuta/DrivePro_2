import { httpError, isFiniteNum } from './util.js';

// Geocoding and routing proxy. The app never talks to OpenStreetMap services
// directly - requests go through here so we can set a proper User-Agent,
// cache results and swap providers later without touching the app.

const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
// Optional comma-separated ISO codes to limit search results, e.g. 'kz,ru'.
const COUNTRIES = (process.env.DRIVEPRO_COUNTRIES || '').trim().toLowerCase();
const OSRM_URL = process.env.OSRM_URL || 'https://router.project-osrm.org';
const USER_AGENT = 'DrivePro/0.1 (personal project)';
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

export async function route(fromLat, fromLng, toLat, toLng) {
  if (![fromLat, fromLng, toLat, toLng].every(isFiniteNum)) {
    throw httpError(400, 'from and to coordinates are required');
  }
  const key = `route:${fromLat.toFixed(5)},${fromLng.toFixed(5)}:${toLat.toFixed(5)},${toLng.toFixed(5)}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const url =
    `${OSRM_URL}/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}` +
    `?overview=full&geometries=geojson&alternatives=false&steps=false`;
  const json = await upstream(url);
  if (!json || json.code !== 'Ok' || !json.routes || !json.routes[0]) {
    throw httpError(502, 'no route found');
  }
  const r = json.routes[0];
  const value = {
    distanceM: Math.round(r.distance),
    durationS: Math.round(r.duration),
    // GeoJSON is [lng, lat]; the app works in [lat, lng].
    points: (r.geometry && r.geometry.coordinates ? r.geometry.coordinates : []).map((c) => [c[1], c[0]]),
  };
  cacheSet(key, value);
  return value;
}
