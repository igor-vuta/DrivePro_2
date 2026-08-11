import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Platform, View } from 'react-native';
import { colors } from './theme';
import { getMapKey, getMapStyle } from './mapconfig';

// The map, rendered inside a frame and driven over a small JSON command
// bridge. On phones the frame is a WebView; on web it is an iframe, so the
// whole app stays testable in a desktop browser.
//
// Two engines sit behind one protocol:
//
//   2GIS MapGL  - vector tiles, the real 2GIS basemap with its shops, transit
//                 and building detail. Needs a key, which necessarily runs in
//                 the browser (see mapconfig.js), and a style id per scheme.
//   Leaflet     - CARTO raster tiles over OpenStreetMap. No key, works
//                 anywhere, and is what a deployment with no key still gets.
//
// Both understand exactly the same commands and post exactly the same events,
// so nothing outside this file knows or cares which one is drawing. Falling
// back is not a degraded mode - it is the map this app shipped with.
//
// Ref methods: setCenter({lat, lng, zoom?, animate?}), fitBounds([[lat,lng],...])
// Props: initialCenter, initialZoom, markers, polyline, alts, onAltPick, onMoveEnd, onMoveStart, onReady

// Marker geometry, shared by both engines so a pin does not jump when the
// engine changes: [size, anchor] in CSS pixels.
const MK = { car: 26, place: 19, dot: 19 };

// Both engines want the theme's colours, and MapGL expresses translucency as
// an 8-digit hex rather than a separate opacity, so alpha is baked in here.
const alpha = (hex, a) =>
  `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, '0')}`;

// A key travels into a <script> as a string literal, so anything that could
// close the tag or the quote is removed rather than escaped. 2GIS keys are
// UUID-shaped; nothing legitimate is lost.
const safeToken = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '');

// Marker CSS, identical for both engines - MapGL draws HTML markers, so the
// same classes style the same pins.
const markerCss = () => `
  .mk { display: flex; align-items: center; justify-content: center; }
  .mk-car { font-size: 24px; filter: drop-shadow(0 0 6px ${colors.primary}); }
  .mk-dot { width: 15px; height: 15px; border-radius: 50%; border: 2px solid ${colors.card}; }
  .mk-pickup { background: ${colors.ok}; box-shadow: 0 0 8px 2px ${colors.ok}; }
  .mk-dest { background: ${colors.danger}; box-shadow: 0 0 8px 2px ${colors.danger}; }
  .mk-place { width: 13px; height: 13px; border-radius: 50%; border: 3px solid ${colors.card}; background: ${colors.primary}; box-shadow: 0 1px 4px rgba(0,0,0,0.5); cursor: pointer; }
`;

// The bridge back to the app, the same in both frames.
const postFn = `
  function post(obj) {
    var text = JSON.stringify(obj);
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(text);
    } else if (window.parent && window.parent !== window) {
      window.parent.postMessage({ __dpMap: true, data: text }, '*');
    }
  }
`;

// ----------------------------------------------------------- MapGL ---
//
// Coordinates are [lng, lat] here and [lat, lng] everywhere else in the app,
// so every crossing is done at the edge of this template and nowhere else.

const makeGlHtml = (key, styleId) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: ${colors.bg}; }
  ${markerCss()}
</style>
</head>
<body>
<div id="map"></div>
<script src="https://mapgl.2gis.com/api/js/v1"></script>
<script>
${postFn}
  var ready = false;
  // If MapGL cannot load or refuses the key, the app must not sit forever
  // waiting for a map that is never coming: say ready anyway, and the sheet,
  // the search and the route list all still work over a blank ground.
  function announceReady() {
    if (ready) return;
    ready = true;
    post({ type: 'ready' });
  }
  setTimeout(announceReady, 4000);

  try {
    var map = new mapgl.Map('map', {
      key: '${safeToken(key)}',
      center: [76.9286, 43.2567],
      zoom: 15,
      zoomControl: false,
      // This is a navigation app driven with one thumb; a map that rotates or
      // tilts by accident is a map the user has to repair before continuing.
      disableRotationByUserInteraction: true,
      disablePitchByUserInteraction: true,
      // Shown while the style loads, so the frame never flashes white inside a
      // dark app.
      defaultBackgroundColor: '${colors.bg}',
      ${styleId ? `style: '${safeToken(styleId)}',` : ''}
    });

    var markers = {};
    var route = [];
    var altLines = [];
    var trailLines = [];

    var clear = function (arr) {
      arr.forEach(function (o) {
        try { o.destroy(); } catch (e) {}
      });
      return [];
    };

    // MapGL has no divIcon: an HTML marker carries the same markup the raster
    // engine puts in one, so both draw the identical pin.
    function markerEl(kind) {
      var el = document.createElement('div');
      if (kind === 'car') {
        el.className = 'mk';
        el.innerHTML = '<div class="mk-car">&#128663;</div>';
      } else if (kind === 'place') {
        el.className = 'mk-place';
      } else {
        el.className = 'mk-dot ' + (kind === 'dest' ? 'mk-dest' : 'mk-pickup');
      }
      return el;
    }

    function addMarker(m) {
      var tappable = m.kind === 'place';
      var el = markerEl(m.kind);
      var size = m.kind === 'car' ? ${MK.car} : m.kind === 'place' ? ${MK.place} : ${MK.dot};
      if (tappable) {
        el.addEventListener('click', function (ev) {
          ev.stopPropagation();
          post({ type: 'markertap', id: m.id });
        });
      }
      return new mapgl.HtmlMarker(map, {
        coordinates: [m.lng, m.lat],
        html: el,
        anchor: [size / 2, size / 2],
        // Anything not tappable must let a tap through to the map underneath,
        // or pins would punch dead holes in "tap anywhere to pick a point".
        interactive: tappable,
        preventMapInteractions: tappable,
      });
    }

    function line(points, opts) {
      var coords = points.map(function (p) { return [p[1], p[0]]; });
      var o = { coordinates: coords, interactive: false };
      for (var k in opts) o[k] = opts[k];
      return new mapgl.Polyline(map, o);
    }

    window.__cmd = function (c) {
      try {
        if (typeof c === 'string') c = JSON.parse(c);
        if (c.type === 'setView') {
          var anim = c.animate ? { duration: 400, easing: 'easeOutCubic' } : { animate: false };
          map.setCenter([c.lng, c.lat], anim);
          if (c.zoom) map.setZoom(c.zoom, anim);
        } else if (c.type === 'setMarkers') {
          var keep = {};
          (c.markers || []).forEach(function (m) {
            keep[m.id] = true;
            if (markers[m.id]) {
              markers[m.id].setCoordinates([m.lng, m.lat]);
            } else {
              markers[m.id] = addMarker(m);
            }
          });
          Object.keys(markers).forEach(function (id) {
            if (!keep[id]) {
              try { markers[id].destroy(); } catch (e) {}
              delete markers[id];
            }
          });
        } else if (c.type === 'setPolyline') {
          route = clear(route);
          if (c.points && c.points.length > 1) {
            route.push(line(c.points, { color: '${alpha(colors.primary, 0.16)}', width: 10, zIndex: 2 }));
            route.push(line(c.points, { color: '${alpha(colors.primary, 0.95)}', width: 3, zIndex: 3 }));
          }
        } else if (c.type === 'setAlts') {
          altLines = clear(altLines);
          (c.alts || []).forEach(function (alt, i) {
            if (!alt.points || alt.points.length < 2) return;
            // A fat invisible line makes the thin dashed one easy to hit with
            // a thumb - the same trick the raster engine uses. The visible
            // line listens too: whether MapGL hit-tests a fully transparent
            // polyline is not something the documentation promises, and an
            // alternative route you cannot tap is worse than a small target.
            var hit = line(alt.points, { color: '${alpha(colors.primary, 0)}', width: 22, zIndex: 1, interactive: true });
            var solid = line(alt.points, {
              color: '${alpha(colors.sub, 0.75)}',
              width: 5,
              zIndex: 1,
              dashLength: 10,
              gapLength: 8,
              interactive: true,
            });
            (function (idx) {
              var pick = function () { post({ type: 'altpick', index: idx }); };
              hit.on('click', pick);
              solid.on('click', pick);
            })(i);
            altLines.push(solid);
            altLines.push(hit);
          });
        } else if (c.type === 'setTrails') {
          trailLines = clear(trailLines);
          (c.trails || []).forEach(function (tr) {
            if (!tr.points || tr.points.length < 2) return;
            var a = Math.max(0.12, 1 - (tr.age || 0));
            var fade = function (o) {
              return '${colors.accent}' + Math.round(o * 255).toString(16).padStart(2, '0');
            };
            trailLines.push(line(tr.points, { color: fade(0.1 * a), width: 8, zIndex: 1 }));
            trailLines.push(line(tr.points, { color: fade(0.55 * a), width: 2.5, zIndex: 1 }));
          });
        } else if (c.type === 'fitBounds') {
          if (c.points && c.points.length) {
            var minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
            c.points.forEach(function (p) {
              minLat = Math.min(minLat, p[0]); maxLat = Math.max(maxLat, p[0]);
              minLng = Math.min(minLng, p[1]); maxLng = Math.max(maxLng, p[1]);
            });
            map.fitBounds(
              { southWest: [minLng, minLat], northEast: [maxLng, maxLat] },
              { padding: { top: 40, right: 40, bottom: 40, left: 40 }, maxZoom: 17, animation: { duration: 400 } }
            );
          }
        }
      } catch (e) {}
    };

    map.on('click', function (ev) {
      // A tap on one of 2GIS's own POIs carries its id; the app asks the
      // places proxy what is there, so plain coordinates are all it needs.
      post({ type: 'maptap', lat: ev.lngLat[1], lng: ev.lngLat[0] });
    });
    map.on('movestart', function () { post({ type: 'movestart' }); });
    map.on('moveend', function () {
      // MapGL's move events carry no coordinates - the camera is the source.
      var c = map.getCenter();
      post({ type: 'moveend', lat: c[1], lng: c[0], zoom: map.getZoom() });
    });
    map.on('styleload', announceReady);
  } catch (e) {
    announceReady();
  }
</script>
</body>
</html>`;

// ---------------------------------------------------------- raster ---
//
// OpenStreetMap through Leaflet. No key, no account, works in any country -
// which is why it stays the floor the app can always stand on.

const makeRasterHtml = () => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: ${colors.bg}; }
  ${markerCss()}
  .leaflet-control-attribution { font-size: 9px; background: ${colors.card} !important; color: ${colors.sub} !important; }
  .leaflet-control-attribution a { color: ${colors.sub} !important; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
  var map = L.map('map', { zoomControl: false, attributionControl: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/${colors.mapTiles}/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap &copy; CARTO'
  }).addTo(map);
  map.setView([51.5074, -0.1278], 15);

  var markers = {};
  var polyline = null;
  var altLayer = null;
  var trailLayer = null;

${postFn}

  function iconFor(kind) {
    if (kind === 'car') {
      return L.divIcon({ className: 'mk', html: '<div class="mk-car">&#128663;</div>', iconSize: [26, 26], iconAnchor: [13, 13] });
    }
    if (kind === 'place') {
      return L.divIcon({ className: 'mk', html: '<div class="mk-place"></div>', iconSize: [26, 26], iconAnchor: [13, 13] });
    }
    var cls = kind === 'dest' ? 'mk-dest' : 'mk-pickup';
    return L.divIcon({ className: 'mk', html: '<div class="mk-dot ' + cls + '"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
  }

  window.__cmd = function (c) {
    try {
      if (typeof c === 'string') c = JSON.parse(c);
      if (c.type === 'setView') {
        map.setView([c.lat, c.lng], c.zoom || map.getZoom(), { animate: !!c.animate });
      } else if (c.type === 'setMarkers') {
        var keep = {};
        (c.markers || []).forEach(function (m) {
          keep[m.id] = true;
          if (markers[m.id]) {
            markers[m.id].setLatLng([m.lat, m.lng]);
          } else {
            var tappable = m.kind === 'place';
            var mk = L.marker([m.lat, m.lng], { icon: iconFor(m.kind), interactive: tappable, keyboard: false });
            if (tappable) {
              (function (id) {
                mk.on('click', function (ev) { L.DomEvent.stop(ev); post({ type: 'markertap', id: id }); });
              })(m.id);
            }
            markers[m.id] = mk.addTo(map);
          }
        });
        Object.keys(markers).forEach(function (id) {
          if (!keep[id]) { map.removeLayer(markers[id]); delete markers[id]; }
        });
      } else if (c.type === 'setPolyline') {
        if (polyline) { map.removeLayer(polyline); polyline = null; }
        if (c.points && c.points.length) {
          polyline = L.layerGroup();
          L.polyline(c.points, { color: '${colors.primary}', weight: 10, opacity: 0.16, lineCap: 'round' }).addTo(polyline);
          L.polyline(c.points, { color: '${colors.primary}', weight: 3, opacity: 0.95, lineCap: 'round' }).addTo(polyline);
          polyline.addTo(map);
          if (polyline.bringToFront) polyline.bringToFront();
        }
      } else if (c.type === 'setAlts') {
        if (altLayer) { map.removeLayer(altLayer); altLayer = null; }
        if (c.alts && c.alts.length) {
          altLayer = L.layerGroup();
          c.alts.forEach(function (alt, i) {
            if (!alt.points || alt.points.length < 2) return;
            // A fat invisible line makes the thin dashed one easy to hit.
            var hit = L.polyline(alt.points, { color: '#000', weight: 22, opacity: 0, lineCap: 'round' });
            var line = L.polyline(alt.points, { color: '${colors.sub}', weight: 5, opacity: 0.75, dashArray: '10 8', lineCap: 'round', interactive: false });
            hit.on('click', function (ev) { L.DomEvent.stop(ev); post({ type: 'altpick', index: i }); });
            line.addTo(altLayer);
            hit.addTo(altLayer);
          });
          altLayer.addTo(map);
          // Alternatives sit under the chosen route, never over it.
          if (polyline && polyline.bringToFront) polyline.bringToFront();
        }
      } else if (c.type === 'setTrails') {
        if (trailLayer) { map.removeLayer(trailLayer); trailLayer = null; }
        if (c.trails && c.trails.length) {
          trailLayer = L.layerGroup();
          c.trails.forEach(function (tr) {
            if (!tr.points || tr.points.length < 2) return;
            var a = Math.max(0.12, 1 - (tr.age || 0));
            L.polyline(tr.points, { color: '${colors.accent}', weight: 8, opacity: 0.10 * a, interactive: false, lineCap: 'round' }).addTo(trailLayer);
            L.polyline(tr.points, { color: '${colors.accent}', weight: 2.5, opacity: 0.55 * a, interactive: false, lineCap: 'round' }).addTo(trailLayer);
          });
          trailLayer.addTo(map);
        }
      } else if (c.type === 'fitBounds') {
        if (c.points && c.points.length) {
          map.fitBounds(L.latLngBounds(c.points), { padding: [40, 40], animate: true, maxZoom: 17 });
        }
      }
    } catch (e) {}
  };

  map.on('click', function (ev) { post({ type: 'maptap', lat: ev.latlng.lat, lng: ev.latlng.lng }); });
  map.on('movestart', function () { post({ type: 'movestart' }); });
  map.on('moveend', function () {
    var c = map.getCenter();
    post({ type: 'moveend', lat: c.lat, lng: c.lng, zoom: map.getZoom() });
  });

  post({ type: 'ready' });
</script>
</body>
</html>`;

// Which engine can draw this scheme. MapGL's own style is a light one, and
// 2GIS publishes no dark style anyone can use - a dark map has to be authored
// in their Style Editor and its id configured. So without that id the night
// map stays raster rather than glaring white at 2am.
export function chooseEngine() {
  const key = getMapKey();
  if (!key) return { engine: 'raster' };
  const styleId = getMapStyle(colors.scheme);
  if (colors.scheme === 'dark' && !styleId) return { engine: 'raster' };
  return { engine: 'gl', key, styleId };
}

const MapViewCmp = forwardRef(function MapViewCmp(
  { initialCenter, initialZoom = 15, markers = [], polyline = null, alts = null, trails = null, onMoveEnd, onMoveStart, onReady, onAltPick, onMarkerTap, onMapTap, style },
  ref
) {
  const isWeb = Platform.OS === 'web';
  const nativeRef = useRef(null);
  const frameRef = useRef(null);
  const readyRef = useRef(false);
  const queueRef = useRef([]);
  const callbacksRef = useRef({});
  callbacksRef.current = { onMoveEnd, onMoveStart, onReady, onAltPick, onMarkerTap, onMapTap, initialCenter, initialZoom };

  // What the map should currently be showing. A frame that has just come up -
  // including a replacement frame, when the basemap key arrives after sign-in
  // and the engine changes underneath us - is repopulated from this rather
  // than waiting for a prop to happen to change again.
  const contentRef = useRef({});
  contentRef.current = { markers, polyline, alts, trails };

  const picked = chooseEngine();
  const html = picked.engine === 'gl' ? makeGlHtml(picked.key, picked.styleId) : makeRasterHtml();

  const send = (cmd) => {
    if (!readyRef.current) {
      queueRef.current.push(cmd);
      return;
    }
    if (isWeb) {
      const w = frameRef.current && frameRef.current.contentWindow;
      if (w && w.__cmd) w.__cmd(cmd);
    } else if (nativeRef.current) {
      nativeRef.current.injectJavaScript(`window.__cmd(${JSON.stringify(cmd)});true;`);
    }
  };

  const handleMsg = (msg) => {
    const cb = callbacksRef.current;
    if (msg.type === 'ready') {
      readyRef.current = true;
      if (cb.initialCenter) {
        send({ type: 'setView', lat: cb.initialCenter.lat, lng: cb.initialCenter.lng, zoom: cb.initialZoom, animate: false });
      }
      const q = queueRef.current;
      queueRef.current = [];
      q.forEach(send);
      const c = contentRef.current;
      send({ type: 'setMarkers', markers: c.markers || [] });
      send({ type: 'setPolyline', points: c.polyline });
      send({ type: 'setAlts', alts: c.alts || [] });
      if (c.trails) send({ type: 'setTrails', trails: c.trails });
      if (cb.onReady) cb.onReady();
    } else if (msg.type === 'markertap') {
      if (cb.onMarkerTap) cb.onMarkerTap(msg.id);
    } else if (msg.type === 'maptap') {
      if (cb.onMapTap) cb.onMapTap({ lat: msg.lat, lng: msg.lng });
    } else if (msg.type === 'altpick') {
      if (cb.onAltPick) cb.onAltPick(msg.index);
    } else if (msg.type === 'moveend') {
      if (cb.onMoveEnd) cb.onMoveEnd({ lat: msg.lat, lng: msg.lng, zoom: msg.zoom });
    } else if (msg.type === 'movestart') {
      if (cb.onMoveStart) cb.onMoveStart();
    }
  };

  useImperativeHandle(ref, () => ({
    setCenter({ lat, lng, zoom, animate = true }) {
      send({ type: 'setView', lat, lng, zoom, animate });
    },
    fitBounds(points) {
      send({ type: 'fitBounds', points });
    },
  }));

  // Swapping engines replaces the frame, so anything already sent to the old
  // one is gone: commands queue again until the new frame says it is ready,
  // and 'ready' replays the whole picture.
  useEffect(() => {
    readyRef.current = false;
    queueRef.current = [];
  }, [picked.engine]);

  useEffect(() => {
    send({ type: 'setMarkers', markers });
  }, [JSON.stringify(markers)]);

  useEffect(() => {
    send({ type: 'setPolyline', points: polyline });
  }, [JSON.stringify(polyline)]);

  React.useEffect(() => {
    send({ type: 'setAlts', alts: alts || [] });
  }, [JSON.stringify(alts)]);

  useEffect(() => {
    if (trails) send({ type: 'setTrails', trails });
  }, [JSON.stringify(trails)]);

  // Web: messages arrive on the window from the iframe.
  useEffect(() => {
    if (!isWeb) return undefined;
    const listener = (e) => {
      const d = e.data;
      if (!d || !d.__dpMap) return;
      const w = frameRef.current && frameRef.current.contentWindow;
      if (e.source !== w) return;
      try {
        handleMsg(JSON.parse(d.data));
      } catch (err) {}
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [isWeb]);

  if (isWeb) {
    return (
      <View style={[{ flex: 1, overflow: 'hidden' }, style]}>
        <iframe
          key={picked.engine}
          ref={frameRef}
          srcDoc={html}
          title="map"
          style={{ border: 0, width: '100%', height: '100%', display: 'block' }}
        />
      </View>
    );
  }

  const { WebView } = require('react-native-webview');
  return (
    <WebView
      key={picked.engine}
      ref={nativeRef}
      originWhitelist={['*']}
      source={{ html }}
      onMessage={(e) => {
        try {
          handleMsg(JSON.parse(e.nativeEvent.data));
        } catch (err) {}
      }}
      javaScriptEnabled
      domStorageEnabled={false}
      allowsBackForwardNavigationGestures={false}
      setSupportMultipleWindows={false}
      overScrollMode="never"
      bounces={false}
      style={[{ flex: 1 }, style]}
    />
  );
});

export default MapViewCmp;
