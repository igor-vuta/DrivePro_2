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

// The basemap is the one 2GIS product that cannot be proxied: MapGL draws
// vector tiles in the browser and authenticates itself from there, so its key
// is necessarily visible to whoever is running the map. That makes it a
// different kind of secret from the catalog key above, and it deserves its own
// variable - ideally a second key, restricted in the 2GIS console to this
// site's domain, so publishing it grants nothing anywhere else.
//
// Falling back to the catalog key keeps a single-key deployment working, but
// it publishes a key that also spends the catalog quota, so boot says so out
// loud rather than letting it pass unnoticed.
const TWOGIS_MAP_KEY = process.env.TWOGIS_MAP_KEY || '';
export const mapKey = () => TWOGIS_MAP_KEY || TWOGIS_KEY;

// A style id per scheme, from https://styles.2gis.com. MapGL's built-in style
// is a light one and 2GIS publishes no dark style anyone can reference, so a
// dark map has to be authored there and named here; with no dark id the app
// keeps the raster basemap at night rather than glaring.
export const mapStyles = () => ({
  light: process.env.TWOGIS_MAP_STYLE || null,
  dark: process.env.TWOGIS_MAP_STYLE_DARK || null,
});
export function describeMapKey() {
  if (TWOGIS_MAP_KEY) return 'Map: 2GIS MapGL (own browser key)';
  if (TWOGIS_KEY) return 'Map: 2GIS MapGL !! reusing TWOGIS_KEY in browsers - set TWOGIS_MAP_KEY to a domain-restricted key';
  return 'Map: OpenStreetMap raster (no TWOGIS_MAP_KEY)';
}

const TIMEOUT_MS = 8000;
const CACHE_MAX = 2000;
const MAX_RADIUS_M = 5000;

// The catalog plan allows a thousand calls a month, which for a city app is
// not many - two people searching for a pharmacy on the same street should
// cost one call, not two, and should still cost nothing tomorrow. So the cache
// is deliberately blunt in three ways:
//
//   - it lives a day or a week rather than five minutes, because a pharmacy
//     does not move and its opening hours do not change by lunchtime;
//   - its keys are rounded to roughly a city block, so "near me" answers are
//     shared between everyone standing in the same neighbourhood;
//   - it survives a restart, because this app redeploys on every push and a
//     cache that empties on every deploy is a cache that never warms up.
//
// The cost of all this is staleness: a shop that closed today may be listed
// until tomorrow. For finding your way to a building that is the right trade.
const TTL = {
  search: 24 * 60 * 60 * 1000,
  near: 24 * 60 * 60 * 1000,
  // A tap on a building and a place's own details are the most stable answers
  // there are - the building will be there next week.
  at: 7 * 24 * 60 * 60 * 1000,
  id: 7 * 24 * 60 * 60 * 1000,
};

// ~1.1 km at Almaty's latitude: everyone in a neighbourhood shares an answer.
const coarse = (n) => n.toFixed(2);
// ~11 m: a tap on a building has to stay on that building.
const fine = (n) => n.toFixed(4);
// Radii snap to buckets so 1200 and 1250 are not two different questions.
const bucketRadius = (m) => (m <= 300 ? 300 : m <= 800 ? 800 : m <= 1500 ? 1500 : m <= 3000 ? 3000 : 5000);

const cache = new Map();
let cacheFile = '';
let saveTimer = null;
let upstreamCalls = 0;

export const placesEnabled = () => !!TWOGIS_KEY;

// Called from index.js once DATA_DIR is known. Without it everything still
// works, the cache just starts empty on every boot.
export async function initPlaces(dataDir) {
  if (!dataDir) return;
  const { join } = await import('node:path');
  const fs = await import('node:fs');
  cacheFile = join(dataDir, 'places-cache.json');
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const now = Date.now();
    for (const [k, v] of raw.entries || []) {
      // Entries that expired while the process was down are not worth loading.
      if (v && v.at && now - v.at < (TTL[v.kind] || TTL.search)) cache.set(k, v);
    }
    upstreamCalls = Number(raw.upstreamCalls) || 0;
    console.log(`Places: cache warm (${cache.size} entries, ${upstreamCalls} upstream calls so far)`);
  } catch {
    // No cache yet, or an unreadable one. Either way, start clean.
  }
}

function scheduleSave() {
  if (!cacheFile || saveTimer) return;
  // Batched: a burst of searches writes the file once, ten seconds later.
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      const fs = await import('node:fs');
      fs.writeFileSync(cacheFile, JSON.stringify({ upstreamCalls, entries: [...cache.entries()] }));
    } catch {
      // A cache that cannot be written is not worth an error path; it just
      // means the next boot starts cold.
    }
  }, 10_000);
  if (saveTimer.unref) saveTimer.unref();
}

function cacheGet(key, kind) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > (TTL[kind] || TTL.search)) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, kind, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), kind, value });
  scheduleSave();
}

// 2GIS locales carry a region, not just a language, and the region selects
// the dataset: asking for Almaty with ru_RU returns "Results not found", and
// en_US is rejected outright. Kazakhstan offers exactly ru_KZ and kk_KZ -
// there is no en_KZ - so English speakers get Russian names, which is what
// Almaty business names are anyway. TWOGIS_LOCALE overrides the lot for a
// deployment in another country.
const LOCALE_OVERRIDE = process.env.TWOGIS_LOCALE || '';
const LOCALES = { ru: 'ru_KZ', kk: 'kk_KZ', en: 'ru_KZ' };
const localeFor = (lang) => LOCALE_OVERRIDE || LOCALES[lang] || LOCALES.ru;

// The documented maximum is 50; the live API refuses anything over 10.
const PAGE_MAX = 10;
const pageSize = (n) => Math.max(1, Math.min(PAGE_MAX, Math.round(n) || PAGE_MAX));

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
  // The quota is a thousand a month and there is no dashboard in front of us,
  // so every call that actually leaves this machine is counted and the total
  // is said out loud occasionally. Silence is how you find out in September.
  upstreamCalls += 1;
  if (upstreamCalls % 25 === 0) console.log(`[places] ${upstreamCalls} upstream calls made`);
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
      // The provider's own wording ("Length of parameter 'page_size'…") is for
      // us, not for someone standing on a street corner: log it, show a
      // sentence a person can act on.
      const detail = (json && json.meta && json.meta.error && json.meta.error.message) || `HTTP ${res.status}`;
      console.warn(`[places] upstream refused: ${detail}`);
      throw httpError(502, 'Places are unavailable right now.', 'places_upstream');
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
export async function searchPlaces(q, lat, lng, lang, limit = PAGE_MAX) {
  requireKey();
  const query = String(q || '').trim();
  if (query.length < 2) throw httpError(400, 'query too short');
  const near = isFiniteNum(lat) && isFiniteNum(lng);
  const key = `psearch:${query.toLowerCase()}:${near ? `${coarse(lat)},${coarse(lng)}` : ''}:${lang || ''}`;
  const hit = cacheGet(key, 'search');
  if (hit) return hit;
  const url =
    `${TWOGIS_URL}?q=${encodeURIComponent(query)}` +
    (near ? `&location=${lng},${lat}&sort=distance` : '') +
    `&page_size=${pageSize(limit)}&fields=${FIELDS}&locale=${localeFor(lang)}&key=${encodeURIComponent(TWOGIS_KEY)}`;
  const value = normList(await upstream(url), limit);
  cacheSet(key, 'search', value);
  return value;
}

// Everything of one kind around a point - what the category chips ask for.
export async function placesNear(lat, lng, q, radiusM, lang, limit = PAGE_MAX) {
  requireKey();
  if (!isFiniteNum(lat) || !isFiniteNum(lng)) throw httpError(400, 'lat and lng are required');
  const query = String(q || '').trim();
  if (!query) throw httpError(400, 'a category is required');
  const radius = Math.max(100, Math.min(MAX_RADIUS_M, Math.round(radiusM) || 1500));
  const key = `pnear:${query.toLowerCase()}:${coarse(lat)},${coarse(lng)}:${bucketRadius(radius)}:${lang || ''}`;
  const hit = cacheGet(key, 'near');
  if (hit) return hit;
  const url =
    `${TWOGIS_URL}?q=${encodeURIComponent(query)}&point=${lng},${lat}&radius=${radius}&sort=distance` +
    `&page_size=${pageSize(limit)}&fields=${FIELDS}&locale=${localeFor(lang)}&key=${encodeURIComponent(TWOGIS_KEY)}`;
  const value = normList(await upstream(url), limit);
  cacheSet(key, 'near', value);
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
  const key = `pat:${fine(lat)},${fine(lng)}:${radius}:${lang || ''}`;
  const hit = cacheGet(key, 'at');
  if (hit) return hit;
  const url =
    `${TWOGIS_URL}?point=${lng},${lat}&radius=${radius}&type=branch&sort=distance` +
    `&page_size=${pageSize(limit)}&fields=${FIELDS}&locale=${localeFor(lang)}&key=${encodeURIComponent(TWOGIS_KEY)}`;
  const value = normList(await upstream(url), limit);
  cacheSet(key, 'at', value);
  return value;
}

// One place in full, for the card shown after tapping it.
export async function placeById(id, lang) {
  requireKey();
  const pid = String(id || '').trim();
  if (!pid) throw httpError(400, 'id is required');
  const key = `pid:${pid}:${lang || ''}`;
  const hit = cacheGet(key, 'id');
  if (hit) return hit;
  const url =
    `${TWOGIS_URL}/byid?id=${encodeURIComponent(pid)}&fields=${FIELDS}` +
    `&locale=${localeFor(lang)}&key=${encodeURIComponent(TWOGIS_KEY)}`;
  const list = normList(await upstream(url), 1);
  if (!list.length) throw httpError(404, 'no such place', 'no_place');
  cacheSet(key, 'id', list[0]);
  return list[0];
}
