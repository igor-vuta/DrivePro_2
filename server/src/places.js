import { httpError, isFiniteNum } from './util.js';

// Places (POI) proxy. The app never talks to a places provider directly: the
// key stays on this machine, results are normalised into one shape, and the
// provider can be swapped or supplemented without the client noticing.
//
// Today the provider is 2GIS, whose Kazakhstan data is far better than
// anything else available - names, categories, opening hours. The normalised
// shape below is deliberately provider-neutral so an OpenStreetMap source can
// be added beside it later.

const TWOGIS_KEY = process.env.TWOGIS_KEY || '';
// A test seam, the same idea as TWILIO_API_URL and OSRM_FALLBACK_URL: point
// the catalog at a stub so smoke tests never touch the real API.
const TWOGIS_URL = process.env.TWOGIS_API_URL || 'https://catalog.api.2gis.com/3.0/items';

const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 400;
const MAX_RADIUS_M = 5000;

const cache = new Map();

export const placesEnabled = () => !!TWOGIS_KEY;

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
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}

// Our languages onto 2GIS locales. Kazakh falls back to Russian: the catalog
// carries Kazakhstan business data in Russian, so a kk locale would mostly
// return the same strings while risking an unsupported-locale error.
const locales = { en: 'en_US', ru: 'ru_RU', kk: 'ru_RU' };

// Everything the app is allowed to know about a place, whoever supplied it.
const FIELDS = [
  'items.point',
  'items.address',
  'items.full_address_name',
  'items.rubrics',
  'items.schedule',
  'items.contact_groups',
].join(',');

async function upstream(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    const json = await res.json().catch(() => null);
    // 2GIS reports failures inside meta, not only by status - and a 404 here
    // means "nothing matched", which is an empty list, not an error.
    const code = json && json.meta && json.meta.code;
    if (code === 404) return { result: { items: [] } };
    if (!res.ok || (code && code >= 400)) {
      const msg = (json && json.meta && json.meta.error && json.meta.error.message) || `places service responded ${res.status}`;
      throw httpError(502, msg);
    }
    return json || { result: { items: [] } };
  } catch (e) {
    if (e.status) throw e;
    throw httpError(502, 'places service unavailable');
  } finally {
    clearTimeout(timer);
  }
}

// 2GIS schedule -> a compact { mon: [{from,to}], ..., everyday? } the app can
// render without knowing the provider. Unparseable schedules become null
// rather than a half-understood object.
function normSchedule(s) {
  if (!s || typeof s !== 'object') return null;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const out = {};
  let any = false;
  for (const d of days) {
    const w = s[d];
    if (w && Array.isArray(w.working_hours) && w.working_hours.length) {
      out[d.toLowerCase()] = w.working_hours.map((h) => ({ from: String(h.from || ''), to: String(h.to || '') }));
      any = true;
    }
  }
  if (s.is_24x7) return { is24x7: true };
  return any ? out : null;
}

function normPhones(groups) {
  const out = [];
  for (const g of groups || []) {
    for (const c of g.contacts || []) {
      if (c.type === 'phone' && c.value) out.push(String(c.value));
    }
  }
  return out.slice(0, 3);
}

function normItem(it) {
  const p = it.point || {};
  if (!isFiniteNum(p.lat) || !isFiniteNum(p.lon)) return null;
  return {
    id: String(it.id || ''),
    name: String(it.name || '').slice(0, 200),
    address: String(it.address_name || it.full_address_name || '').slice(0, 200),
    fullAddress: String(it.full_address_name || '').slice(0, 300),
    lat: Number(p.lat),
    lng: Number(p.lon),
    categories: (it.rubrics || []).map((r) => String(r.name || '')).filter(Boolean).slice(0, 4),
    schedule: normSchedule(it.schedule),
    phones: normPhones(it.contact_groups),
  };
}

function normList(json, limit) {
  const items = (json && json.result && json.result.items) || [];
  return items.map(normItem).filter(Boolean).slice(0, limit);
}

function requireKey() {
  if (!TWOGIS_KEY) throw httpError(503, 'places are not configured', 'places_off');
}

// Free-text: a name ("Dostyk Plaza") or a category word ("pharmacy").
export async function searchPlaces(q, lat, lng, lang, limit = 12) {
  requireKey();
  const query = String(q || '').trim();
  if (query.length < 2) throw httpError(400, 'query too short');
  const near = isFiniteNum(lat) && isFiniteNum(lng);
  const key = `psearch:${query.toLowerCase()}:${near ? `${lat.toFixed(3)},${lng.toFixed(3)}` : ''}:${lang || ''}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const url =
    `${TWOGIS_URL}?q=${encodeURIComponent(query)}` +
    (near ? `&location=${lng},${lat}&sort=distance` : '') +
    `&page_size=${Math.min(20, limit)}&fields=${FIELDS}&locale=${locales[lang] || locales.ru}&key=${encodeURIComponent(TWOGIS_KEY)}`;
  const value = normList(await upstream(url), limit);
  cacheSet(key, value);
  return value;
}

// Everything of one kind around a point - what the category chips ask for.
export async function placesNear(lat, lng, q, radiusM, lang, limit = 20) {
  requireKey();
  if (!isFiniteNum(lat) || !isFiniteNum(lng)) throw httpError(400, 'lat and lng are required');
  const query = String(q || '').trim();
  if (!query) throw httpError(400, 'a category is required');
  const radius = Math.max(100, Math.min(MAX_RADIUS_M, Math.round(radiusM) || 1500));
  const key = `pnear:${query.toLowerCase()}:${lat.toFixed(3)},${lng.toFixed(3)}:${radius}:${lang || ''}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const url =
    `${TWOGIS_URL}?q=${encodeURIComponent(query)}&point=${lng},${lat}&radius=${radius}&sort=distance` +
    `&page_size=${Math.min(20, limit)}&fields=${FIELDS}&locale=${locales[lang] || locales.ru}&key=${encodeURIComponent(TWOGIS_KEY)}`;
  const value = normList(await upstream(url), limit);
  cacheSet(key, value);
  return value;
}

// "What is at this point?" - what a tap on the map asks. The provider has no
// point-lookup call, and a wildcard query returns nothing; the working shape
// is a tight radius restricted to businesses, nearest first. Without the type
// filter the answer is administrative districts, which is not what a finger
// on a building means.
export async function placesAt(lat, lng, radiusM, lang, limit = 1) {
  requireKey();
  if (!isFiniteNum(lat) || !isFiniteNum(lng)) throw httpError(400, 'lat and lng are required');
  const radius = Math.max(20, Math.min(300, Math.round(radiusM) || 80));
  const key = `pat:${lat.toFixed(4)},${lng.toFixed(4)}:${radius}:${lang || ''}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const url =
    `${TWOGIS_URL}?point=${lng},${lat}&radius=${radius}&type=branch&sort=distance` +
    `&page_size=${Math.min(10, Math.max(1, limit))}&fields=${FIELDS}&locale=${locales[lang] || locales.ru}&key=${encodeURIComponent(TWOGIS_KEY)}`;
  const value = normList(await upstream(url), limit);
  cacheSet(key, value);
  return value;
}

// One place in full, for the card shown after tapping it.
export async function placeById(id, lang) {
  requireKey();
  const pid = String(id || '').trim();
  if (!pid) throw httpError(400, 'id is required');
  const key = `pid:${pid}:${lang || ''}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const url =
    `${TWOGIS_URL}/byid?id=${encodeURIComponent(pid)}&fields=${FIELDS}` +
    `&locale=${locales[lang] || locales.ru}&key=${encodeURIComponent(TWOGIS_KEY)}`;
  const list = normList(await upstream(url), 1);
  if (!list.length) throw httpError(404, 'no such place', 'no_place');
  cacheSet(key, list[0]);
  return list[0];
}
