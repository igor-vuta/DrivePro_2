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
