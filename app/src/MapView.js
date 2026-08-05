import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Platform, View } from 'react-native';

// OpenStreetMap map rendered with Leaflet, driven over a small JSON command
// bridge. On phones it lives in a WebView; on web the same HTML runs in an
// iframe, so the app is fully testable in a desktop browser too. No API keys.
//
// Ref methods: setCenter({lat, lng, zoom?, animate?}), fitBounds([[lat,lng],...])
// Props: initialCenter, initialZoom, markers, polyline, onMoveEnd, onMoveStart, onReady

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #e8e6e1; }
  .mk { display: flex; align-items: center; justify-content: center; }
  .mk-car { font-size: 24px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); }
  .mk-dot { width: 16px; height: 16px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4); }
  .mk-pickup { background: #2e7d32; }
  .mk-dest { background: #c62828; }
  .leaflet-control-attribution { font-size: 9px; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
  var map = L.map('map', { zoomControl: false, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  map.setView([51.5074, -0.1278], 15);

  var markers = {};
  var polyline = null;

  function post(obj) {
    var text = JSON.stringify(obj);
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(text);
    } else if (window.parent && window.parent !== window) {
      window.parent.postMessage({ __dpMap: true, data: text }, '*');
    }
  }

  function iconFor(kind) {
    if (kind === 'car') {
      return L.divIcon({ className: 'mk', html: '<div class="mk-car">&#128663;</div>', iconSize: [26, 26], iconAnchor: [13, 13] });
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
            markers[m.id] = L.marker([m.lat, m.lng], { icon: iconFor(m.kind), interactive: false }).addTo(map);
          }
        });
        Object.keys(markers).forEach(function (id) {
          if (!keep[id]) { map.removeLayer(markers[id]); delete markers[id]; }
        });
      } else if (c.type === 'setPolyline') {
        if (polyline) { map.removeLayer(polyline); polyline = null; }
        if (c.points && c.points.length) {
          polyline = L.polyline(c.points, { color: '#111', weight: 4, opacity: 0.85 }).addTo(map);
        }
      } else if (c.type === 'fitBounds') {
        if (c.points && c.points.length) {
          map.fitBounds(L.latLngBounds(c.points), { padding: [40, 40], animate: true, maxZoom: 17 });
        }
      }
    } catch (e) {}
  };

  map.on('movestart', function () { post({ type: 'movestart' }); });
  map.on('moveend', function () {
    var c = map.getCenter();
    post({ type: 'moveend', lat: c.lat, lng: c.lng, zoom: map.getZoom() });
  });

  post({ type: 'ready' });
</script>
</body>
</html>`;

const MapViewCmp = forwardRef(function MapViewCmp(
  { initialCenter, initialZoom = 15, markers = [], polyline = null, onMoveEnd, onMoveStart, onReady, style },
  ref
) {
  const isWeb = Platform.OS === 'web';
  const nativeRef = useRef(null);
  const frameRef = useRef(null);
  const readyRef = useRef(false);
  const queueRef = useRef([]);
  const callbacksRef = useRef({});
  callbacksRef.current = { onMoveEnd, onMoveStart, onReady, initialCenter, initialZoom };

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
      if (cb.onReady) cb.onReady();
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

  useEffect(() => {
    send({ type: 'setMarkers', markers });
  }, [JSON.stringify(markers)]);

  useEffect(() => {
    send({ type: 'setPolyline', points: polyline });
  }, [JSON.stringify(polyline)]);

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
