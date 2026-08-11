// Which basemap the app is allowed to draw.
//
// MapGL renders vector tiles in the browser and authenticates from there, so
// its key cannot live on the server the way the catalog key does - /api/me
// hands it to signed-in clients instead of it being baked into the bundle.
// Deployments without one fall back to OpenStreetMap raster tiles, so the app
// never depends on a key existing.
//
// Style ids are the other half. 2GIS publishes no dark style that anyone can
// use: a dark map is authored in their Style Editor and referenced by id, so
// until a deployment configures one, night stays on the raster basemap rather
// than turning the screen white at 2am.
//
// Module values rather than props, for the same reason `colors` is one: the
// map builds its HTML at mount and reads these once, and threading them
// through every screen that happens to show a map would say nothing this
// doesn't.

let key = null;
let styles = { light: null, dark: null };

const str = (v) => (typeof v === 'string' && v ? v : null);

export function setMapKey(k) {
  key = str(k);
}

export function getMapKey() {
  return key;
}

export function setMapStyles(s) {
  styles = { light: str(s && s.light), dark: str(s && s.dark) };
}

export function getMapStyle(scheme) {
  return (scheme === 'dark' ? styles.dark : styles.light) || null;
}

// Where 2GIS actually has a map.
//
// MapGL does not refuse a request outside its footprint - it hands back an
// empty world, which looks exactly like a broken app. Routing already learned
// this lesson from Leicester (see geo.js): the answer is not to trust a
// provider outside the ground it covers. OpenStreetMap covers everywhere, so
// beyond these boxes the raster engine draws the map.
//
// Boxes rather than a polygon because the question is "is there a map here",
// not "which country is this" - a generous box that includes some empty steppe
// costs nothing, and anything not listed simply gets OSM, which works. Listed
// deliberately conservatively: when in doubt, leave it out and get a map that
// definitely renders.
const COVERED = [
  // name            latMin  latMax  lngMin  lngMax
  ['Kazakhstan',      40.5,   55.5,   46.4,   87.4],
  ['Russia',          41.0,   82.0,   19.0,  180.0],
  ['Russia (far east)', 60.0, 72.0, -180.0, -168.0],
  ['Kyrgyzstan',      39.0,   43.4,   69.0,   80.3],
  ['Uzbekistan',      37.0,   45.7,   55.9,   73.2],
  ['Tajikistan',      36.6,   41.1,   67.3,   75.2],
  ['Azerbaijan',      38.3,   42.0,   44.7,   50.6],
  ['Georgia',         41.0,   43.6,   40.0,   46.8],
  ['Armenia',         38.8,   41.4,   43.4,   46.7],
  ['Belarus',         51.2,   56.2,   23.1,   32.8],
  ['Ukraine',         44.0,   52.4,   22.0,   40.3],
  ['UAE',             22.6,   26.2,   51.0,   56.4],
  ['Saudi Arabia',    16.0,   32.2,   34.5,   55.7],
  ['Czechia',         48.5,   51.1,   12.0,   18.9],
  ['Cyprus',          34.5,   35.8,   32.2,   34.6],
  ['Chile',          -56.0,  -17.0,  -76.0,  -66.0],
];

export function covers2gis(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
    // Nothing to judge yet - the deployment's own city is the safe assumption,
    // and an engine switch when the real position arrives is one remount.
    return true;
  }
  return COVERED.some(([, laMin, laMax, lnMin, lnMax]) => lat >= laMin && lat <= laMax && lng >= lnMin && lng <= lnMax);
}
