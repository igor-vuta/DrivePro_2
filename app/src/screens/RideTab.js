import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Linking, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { notify, confirmAction } from '../dialogs';
import * as Location from 'expo-location';
import MapView from '../MapView';
import { Card, Button, Input, Sub, ErrorText, Row, Avatar, FadeIn, Pop, Bleed, SCREEN_PAD, CHROME_H, colors } from '../ui';
import { useAuth } from '../state';
import { api } from '../api';
import { wsClient } from '../ws';
import UserProfileModal from '../UserProfileModal';
import { t, errMsg, getLang } from '../i18n';
import { API_URL } from '../config';

// Almaty, Kazakhstan - used until real geolocation arrives.
// Thin a polyline before sending it over the socket.
function simplifyPts(pts, max = 60) {
  if (!Array.isArray(pts) || pts.length <= max) return pts || [];
  const step = (pts.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

const FALLBACK_CENTER = { lat: 43.2389, lng: 76.8897 };

const cleanDetails = (d) => {
  if (!d) return undefined;
  const out = {};
  for (const k of ['entrance', 'apartment', 'floor', 'intercom', 'note']) {
    if (d[k] && d[k].trim()) out[k] = d[k].trim();
  }
  return Object.keys(out).length ? out : undefined;
};

function haversineM(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

function fmtDistance(m) {
  if (m == null) return '';
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

function fmtDuration(s) {
  if (s == null) return '';
  const min = Math.max(1, Math.round(s / 60));
  return min < 60 ? `~${min} min` : `~${Math.floor(min / 60)} h ${min % 60} min`;
}

// The three ways to get there on your own, in the order they are offered.
// Each maps to a real OSRM profile server-side (L31).
const TRAVEL_MODES = [
  { key: 'foot', icon: '🚶', label: 'ride.modeFoot' },
  { key: 'bike', icon: '🚲', label: 'ride.modeBike' },
  { key: 'car', icon: '🚗', label: 'ride.modeCar' },
];

// One tile in the walk / cycle / drive picker: icon, name, real ETA.
function ModeTile({ icon, label, route, active, onPress, style }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          flex: 1,
          alignItems: 'center',
          paddingVertical: 10,
          borderRadius: 16,
          borderWidth: active ? 2 : 1,
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: colors.card,
          opacity: pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      <Text style={{ fontSize: 20 }}>{icon}</Text>
      <Text style={{ color: active ? colors.primary : colors.text, fontWeight: '700', fontSize: 13, marginTop: 2 }}>{label}</Text>
      <Text style={{ color: colors.sub, fontSize: 12, marginTop: 2 }}>
        {route ? fmtDuration(route.durationS) : '…'}
      </Text>
      {route ? <Text style={{ color: colors.sub, fontSize: 11 }}>{fmtDistance(route.distanceM)}</Text> : null}
    </Pressable>
  );
}

export default function RideTab() {
  const { token, me, activeRide, counterpart, driverLoc } = useAuth();
  const mapRef = useRef(null);

  const myRide = activeRide && me && activeRide.riderId === me.id ? activeRide : null;
  const drivingElsewhere = activeRide && me && activeRide.driverId === me.id;
  const searching = myRide && myRide.status === 'requested';
  const matched = myRide && myRide.status !== 'requested';

  // Map-first flow: land on the map, pick where you're going, see how long it
  // takes to walk / cycle / drive there, and optionally ask for a shared ride.
  // The shared-ride path reuses the original pickup -> confirm -> request
  // machinery untouched.
  //   landing -> mode -> [pickup -> confirm] (shared ride)
  const [step, setStep] = useState('landing'); // landing | mode | pickup | dest | confirm
  const [mode, setMode] = useState('car'); // car | foot | bike (solo route shown)
  const [modeRoutes, setModeRoutes] = useState({}); // mode -> route
  const [origin, setOrigin] = useState(null); // where the solo routes start from
  const [originGuessed, setOriginGuessed] = useState(false); // origin is the fallback centre, not the user
  const [center, setCenter] = useState(FALLBACK_CENTER);
  const [trails, setTrails] = useState([]);
  const [address, setAddress] = useState('');
  const [addrLoading, setAddrLoading] = useState(false);
  const [pickup, setPickup] = useState(null); // {lat, lng, address}
  const [dest, setDest] = useState(null);
  const [route, setRoute] = useState(null); // {distanceM, durationS, points, approx}
  const [routeLoading, setRouteLoading] = useState(false);
  const [comment, setComment] = useState('');
  const [pickupDetails, setPickupDetails] = useState({});
  const [destDetails, setDestDetails] = useState({});
  const [cars, setCars] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [schedules, setSchedules] = useState([]);
  const geoSeq = useRef(0);
  // Both route loaders end in fitBounds, and fitBounds fires a moveend that
  // onMoveEnd turns into setCenter + reverseLookup. If the user has navigated
  // away in the meantime that rewrites the point they are currently choosing,
  // so every navigation bumps this and a late response checks it before it
  // touches the map.
  const fitSeq = useRef(0);
  const myLocRef = useRef(null); // last known real location, for the pickup default
  const pickedRef = useRef(null); // point chosen by name, awaiting its moveend
  const interactedRef = useRef(false); // the user has chosen a point of their own

  // Scheduled rides (L14): list + refresh after planner/list mutations.
  const loadSchedules = async () => {
    try {
      const r = await api('GET', '/api/schedules', null, token);
      setSchedules(r.schedules || []);
    } catch (e) {}
  };
  useEffect(() => {
    loadSchedules();
  }, [token]);

  // Center on the user's real location once. The landing step needs an address
  // straight away, so seed one for the fallback centre first - if geolocation
  // is refused the map never moves and no moveend would ever fire.
  useEffect(() => {
    let cancelled = false;
    reverseLookup(centerRef.current);
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const c = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        myLocRef.current = c; // always worth knowing, even if we do not move
        wsClient.send({ type: 'map:watch', ...c });
        // A slow fix must not yank the map away from a destination the user
        // has already chosen, nor re-geocode over the name they picked.
        if (interactedRef.current) return;
        setCenter(c);
        if (mapRef.current) mapRef.current.setCenter({ ...c, zoom: 16, animate: false });
      } catch (e) {
        // stay on fallback center
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Nearby drivers feed + re-watch on reconnect.
  useEffect(() => {
    const offDrivers = wsClient.on('map:drivers', (msg) => setCars(msg.drivers || []));
    const offConn = wsClient.on('connection', ({ connected }) => {
      if (connected) wsClient.send({ type: 'map:watch', ...centerRef.current });
    });
    wsClient.send({ type: 'map:watch', ...center });
    return () => {
      offDrivers();
      offConn();
      wsClient.send({ type: 'map:unwatch' });
    };
  }, []);

  const centerRef = useRef(center);
  centerRef.current = center;

  // Neon trails: glowing traces of recently finished rides, refreshed lazily.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api('GET', '/api/trails', null, token);
        if (cancelled) return;
        const nowMs = Date.now();
        setTrails(
          (r.trails || []).map((tr) => ({
            points: tr.points,
            age: Math.min(1, Math.max(0, (nowMs - tr.finishedAt) / 86_400_000)),
          }))
        );
      } catch (e) {}
    };
    load();
    const iv = setInterval(load, 120_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [token]);

  const reverseLookup = async (c) => {
    const seq = ++geoSeq.current;
    setAddrLoading(true);
    try {
      const r = await api('GET', `/api/geo/reverse?lat=${c.lat}&lng=${c.lng}&lang=${getLang()}`, null, token);
      if (seq === geoSeq.current) setAddress(r.address || '');
    } catch (e) {
      if (seq === geoSeq.current) setAddress(`${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`);
    } finally {
      if (seq === geoSeq.current) setAddrLoading(false);
    }
  };

  const onMoveEnd = (c) => {
    setCenter({ lat: c.lat, lng: c.lng });
    if (step === 'landing' || step === 'pickup' || step === 'dest') {
      // A point the user picked by name (search result or saved place) already
      // carries the label they chose - re-reverse-geocoding it would replace
      // "Medeu" with whatever street the pin happens to land on. Any move to a
      // different point clears the mark, so a stale one cannot linger.
      const picked = pickedRef.current;
      pickedRef.current = null;
      // 1e-4 deg is ~11 m: comfortably above Leaflet's own centre rounding
      // after an animated pan (about half a pixel, a metre or two) and well
      // below any pan a user makes on purpose.
      const samePoint = picked && Math.abs(picked.lat - c.lat) < 1e-4 && Math.abs(picked.lng - c.lng) < 1e-4;
      if (!samePoint) reverseLookup(c);
      wsClient.send({ type: 'map:watch', lat: c.lat, lng: c.lng });
    }
  };

  const doSearch = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    Keyboard.dismiss();
    setError('');
    try {
      const r = await api(
        'GET',
        `/api/geo/search?q=${encodeURIComponent(q)}&lat=${center.lat}&lng=${center.lng}&lang=${getLang()}`,
        null,
        token
      );
      setResults(r.results || []);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  // Jump the map to a point the user named. `center` is normally only updated
  // by the map's moveend, which lands a frame or two later - so set it here
  // too, or confirming straight away would pair the new label with the old
  // coordinates.
  const goTo = (p) => {
    const c = { lat: p.lat, lng: p.lng };
    pickedRef.current = c;
    interactedRef.current = true;
    setAddress(p.address);
    setCenter(c);
    if (mapRef.current) mapRef.current.setCenter({ ...c, zoom: 16 });
  };

  const pickResult = (r) => {
    setResults(null);
    setQuery('');
    goTo(r);
  };

  const goPlace = (p) => goTo(p);

  // Stepping back to a point that was already chosen. The map has moved on
  // since - loadRoute/loadModeRoutes call fitBounds, and onMoveEnd writes the
  // resulting bounding-box centre into `center` - so restoring only the label
  // would leave the next confirm reading the route's midpoint under the right
  // address, and the driver would be sent somewhere nobody picked.
  const backTo = (p) => {
    fitSeq.current++; // same reason as askSharedRide: revoke in-flight fitBounds
    if (p) goTo(p);
    else setAddress('');
  };

  const confirmPoint = async () => {
    interactedRef.current = true;
    const point = { ...center, address: address.trim() || `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}` };
    if (step === 'landing') {
      // Destination chosen: show how to get there, per travel mode. The routes
      // start where the user actually is, not at the map centre - which by now
      // sits on the destination they just dropped the pin on.
      const from = myLocRef.current || pickup || FALLBACK_CENTER;
      // Without a real location the times are measured from the city centre,
      // which can be far from the user - say so rather than quoting a
      // confident number computed from a guess.
      setOriginGuessed(!myLocRef.current && !pickup);
      setDest(point);
      setOrigin(from);
      setStep('mode');
      loadModeRoutes(from, point);
    } else if (step === 'pickup') {
      setPickup(point);
      // Destination is already known (chosen on the landing step), so a shared
      // ride goes straight to confirmation. The old pickup -> dest path is kept
      // as a fallback if dest is somehow unset.
      if (dest) {
        setStep('confirm');
        loadRoute(point, dest);
      } else {
        setStep('dest');
        setAddress('');
        reverseLookup(center);
      }
    } else if (step === 'dest') {
      setDest(point);
      setStep('confirm');
      loadRoute(pickup, point);
    }
  };

  // Route to the destination for all three travel modes at once, so the mode
  // step can show real walk / cycle / drive times side by side. Each failure
  // falls back to a straight-line estimate rather than blocking.
  const loadModeRoutes = async (from, to) => {
    // Three requests in flight; if the user changes destination or leaves the
    // step before they land, the stale batch must not overwrite the new routes
    // or yank the map back with its fitBounds.
    const seq = ++fitSeq.current;
    setModeRoutes({});
    setMode('car');
    const modes = ['foot', 'bike', 'car'];
    const pairs = await Promise.all(
      modes.map(async (m) => {
        try {
          const r = await api(
            'GET',
            `/api/geo/route?fromLat=${from.lat}&fromLng=${from.lng}&toLat=${to.lat}&toLng=${to.lng}&mode=${m}`,
            null,
            token
          );
          return [m, { ...r, approx: false }];
        } catch (e) {
          const d = haversineM(from, to);
          const speed = m === 'foot' ? 1.35 : m === 'bike' ? 4.2 : 8.3; // m/s
          return [m, { distanceM: d, durationS: Math.round(d / speed), points: [[from.lat, from.lng], [to.lat, to.lng]], approx: true }];
        }
      })
    );
    if (seq !== fitSeq.current) return;
    const map = Object.fromEntries(pairs);
    setModeRoutes(map);
    const fit = map.car && map.car.points.length ? map.car.points : [[from.lat, from.lng], [to.lat, to.lng]];
    if (mapRef.current) mapRef.current.fitBounds(fit);
  };

  const showMode = (m) => {
    setMode(m);
    const r = modeRoutes[m];
    if (r && r.points && r.points.length && mapRef.current) mapRef.current.fitBounds(r.points);
  };

  // "Ask for a shared ride": the destination is already set, so the only thing
  // left is where to be picked up. Default that to the rider's real location.
  const askSharedRide = () => {
    const c = myLocRef.current || origin || centerRef.current;
    // The three mode routes may still be in flight; leaving the step revokes
    // their right to move the map, or their fitBounds would land on top of the
    // pickup being chosen here and silently relocate it to the route midpoint.
    fitSeq.current++;
    setStep('pickup');
    setCenter(c);
    if (mapRef.current) mapRef.current.setCenter({ ...c, zoom: 16 });
    reverseLookup(c);
  };

  const backToLanding = () => {
    setStep('landing');
    setModeRoutes({});
    backTo(dest);
  };

  const loadRoute = async (from, to) => {
    const seq = ++fitSeq.current;
    setRouteLoading(true);
    setRoute(null);
    try {
      const r = await api(
        'GET',
        `/api/geo/route?fromLat=${from.lat}&fromLng=${from.lng}&toLat=${to.lat}&toLng=${to.lng}`,
        null,
        token
      );
      if (seq !== fitSeq.current) return;
      setRoute({ ...r, approx: false });
      if (mapRef.current) mapRef.current.fitBounds(r.points.length ? r.points : [[from.lat, from.lng], [to.lat, to.lng]]);
    } catch (e) {
      if (seq !== fitSeq.current) return;
      const d = haversineM(from, to);
      setRoute({ distanceM: d, durationS: null, points: [[from.lat, from.lng], [to.lat, to.lng]], approx: true });
      if (mapRef.current) mapRef.current.fitBounds([[from.lat, from.lng], [to.lat, to.lng]]);
    } finally {
      if (seq === fitSeq.current) setRouteLoading(false);
    }
  };

  const requestRide = () => {
    setError('');
    setBusy(true);
    const ok = wsClient.send({
      type: 'ride:request',
      pickup: { ...pickup, details: cleanDetails(pickupDetails) },
      dest: { ...dest, details: cleanDetails(destDetails) },
      comment: comment.trim(),
      distanceM: route ? route.distanceM : null,
      durationS: route ? route.durationS : null,
      routePoints: route && route.points ? simplifyPts(route.points) : null,
    });
    if (!ok) {
      setBusy(false);
      setError(t('ride.notConnected'));
    }
    // ride:created updates activeRide through global state; busy resets below.
  };

  useEffect(() => {
    if (activeRide) setBusy(false);
  }, [activeRide]);

  // When a ride ends - finished, cancelled or swept - go back to the map
  // rather than leaving the stale confirmation sheet up.
  const prevRideRef = useRef(null);
  useEffect(() => {
    const id = myRide ? myRide.id : null;
    if (prevRideRef.current && !id) resetFlow();
    prevRideRef.current = id;
  }, [myRide]);

  const cancelRide = () => {
    if (!myRide) return;
    if (myRide.status === 'requested') {
      wsClient.send({ type: 'ride:cancel', rideId: myRide.id });
      return;
    }
    confirmAction({
      title: t('ride.cancelQ'),
      message: t('ride.driverNotified'),
      okLabel: t('ride.cancelRide'),
      cancelLabel: t('ride.keepRide'),
      onOk: () => wsClient.send({ type: 'ride:cancel', rideId: myRide.id }),
    });
  };

  const resetFlow = () => {
    fitSeq.current++;
    setStep('landing');
    setPickup(null);
    setDest(null);
    setOrigin(null);
    setModeRoutes({});
    setRoute(null);
    setComment('');
    setPickupDetails({});
    setDestDetails({});
    reverseLookup(centerRef.current);
  };

  // Markers shown on the map.
  const markers = useMemo(() => {
    const list = cars.map((c) => ({ id: `car-${c.id}`, lat: c.lat, lng: c.lng, kind: 'car' }));
    if (pickup && step !== 'pickup') list.push({ id: 'pickup', lat: pickup.lat, lng: pickup.lng, kind: 'pickup' });
    // On the mode step there is no pickup yet - the green dot is simply "you".
    if (origin && step === 'mode') list.push({ id: 'origin', lat: origin.lat, lng: origin.lng, kind: 'pickup' });
    // The destination is chosen first now, so it stays pinned for every step
    // after the landing one (except while it is being re-picked on 'dest').
    if (dest && step !== 'landing' && step !== 'dest') list.push({ id: 'dest', lat: dest.lat, lng: dest.lng, kind: 'dest' });
    return list;
  }, [cars, pickup, dest, origin, step]);

  const polyline =
    step === 'mode'
      ? modeRoutes[mode]
        ? modeRoutes[mode].points
        : null
      : step === 'confirm' && route
      ? route.points
      : null;

  // ---------------------------------------------------------------- render

  if (drivingElsewhere) {
    return (
      <Card>
        <Sub style={{ marginBottom: 0 }}>{t('ride.activeAsDriver')}</Sub>
      </Card>
    );
  }

  // Each ride status is its own Pop, so accepting, arriving, starting and
  // finishing all announce themselves rather than swapping in place.
  if (matched) {
    return (
      <Pop keyId={myRide.status}>
        <DriverOnTheWay ride={myRide} driver={counterpart} driverLoc={driverLoc} onCancel={cancelRide} />
      </Pop>
    );
  }

  if (searching) {
    return (
      <Pop keyId="searching" style={{ flex: 0 }}>
        <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
          <ActivityIndicator size="large" color={colors.text} style={{ marginBottom: 14 }} />
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 }}>
            {t('ride.looking')}
          </Text>
          <Sub style={{ textAlign: 'center' }}>
            {myRide.pickupAddress} → {myRide.destAddress}
          </Sub>
          <Button kind="ghost" title={t('ride.cancelRide')} onPress={cancelRide} style={{ alignSelf: 'stretch' }} />
        </Card>
      </Pop>
    );
  }

  // Landing picks a destination, so its pin is the destination colour.
  const pinColor = step === 'dest' || step === 'landing' ? colors.danger : colors.ok;
  const stepTitle =
    step === 'landing'
      ? t('ride.whereTo')
      : step === 'mode'
      ? t('ride.travelTitle')
      : step === 'pickup'
      ? t('ride.setPickup')
      : step === 'dest'
      ? t('ride.setDest')
      : t('ride.confirm');
  const places = me && me.places ? me.places : null;
  const showCenterPin = step === 'landing' || step === 'pickup' || step === 'dest';

  return (
    <Bleed top>
      <View style={{ flex: 1 }}>
        <MapView
          ref={mapRef}
          initialCenter={center}
          initialZoom={15}
          markers={markers}
          polyline={polyline}
          trails={trails}
          onMoveEnd={onMoveEnd}
        />
        {showCenterPin ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ alignItems: 'center', marginBottom: 34 }}>
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: pinColor, borderWidth: 3, borderColor: colors.text, elevation: 6, shadowColor: pinColor, shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } }} />
              <View style={{ width: 3, height: 14, backgroundColor: pinColor }} />
            </View>
          </View>
        ) : null}
        {/* The map bleeds under the home screen's floating chrome, so the
            results start below it - otherwise the avatar covers the first row
            and takes its taps. */}
        {results ? (
          <View style={{ position: 'absolute', left: 12, right: 12, top: CHROME_H + 8 }}>
            <Card style={{ padding: 6, marginBottom: 0 }}>
              {results.length === 0 ? (
                <Sub style={{ margin: 10 }}>{t('ride.nothingFound')}</Sub>
              ) : (
                results.map((r, i) => (
                  <Pressable key={i} onPress={() => pickResult(r)} style={{ padding: 10, borderBottomWidth: i < results.length - 1 ? 1 : 0, borderColor: colors.border }}>
                    <Text style={{ color: colors.text }}>{r.address}</Text>
                    <Text style={{ color: colors.sub, fontSize: 12 }} numberOfLines={1}>{r.fullAddress}</Text>
                  </Pressable>
                ))
              )}
              <Button kind="ghost" title={t('common.close')} onPress={() => setResults(null)} style={{ height: 38 }} />
            </Card>
          </View>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: SCREEN_PAD, paddingTop: 10, backgroundColor: colors.bg }}>
        <FadeIn keyId={step} from={18}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 8 }}>{stepTitle}</Text>

        {step === 'mode' ? (
          <View>
            <Card style={{ marginBottom: 10 }}>
              <Row>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger, marginRight: 8 }} />
                <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>{dest ? dest.address : ''}</Text>
              </Row>
            </Card>
            <Row style={{ marginBottom: 10 }}>
              {TRAVEL_MODES.map((m, i) => (
                <ModeTile
                  key={m.key}
                  icon={m.icon}
                  label={t(m.label)}
                  route={modeRoutes[m.key]}
                  active={mode === m.key}
                  onPress={() => showMode(m.key)}
                  style={{ marginRight: i < TRAVEL_MODES.length - 1 ? 8 : 0 }}
                />
              ))}
            </Row>
            <Sub style={{ marginBottom: 8 }}>{originGuessed ? t('ride.fromCentre') : t('ride.soloHint')}</Sub>
            <ErrorText>{error}</ErrorText>
            <Button title={t('ride.askShared')} onPress={askSharedRide} />
            <Button kind="ghost" title={t('ride.changeDest')} onPress={backToLanding} style={{ height: 42 }} />
          </View>
        ) : step !== 'confirm' ? (
          <View>
            {step === 'landing' && schedules.length ? (
              <ScheduleList schedules={schedules} onChanged={loadSchedules} />
            ) : null}
            {places && (places.home || places.work) ? (
              <Row style={{ marginBottom: 8 }}>
                {places.home ? (
                  <Button kind="ghost" title={t('ride.homeChip')} onPress={() => goPlace(places.home)} style={{ height: 36, paddingHorizontal: 12, marginRight: 8, marginTop: 0 }} />
                ) : null}
                {places.work ? (
                  <Button kind="ghost" title={t('ride.workChip')} onPress={() => goPlace(places.work)} style={{ height: 36, paddingHorizontal: 12, marginTop: 0 }} />
                ) : null}
              </Row>
            ) : null}
            <Row style={{ marginBottom: 10 }}>
              <Input
                value={query}
                onChangeText={setQuery}
                placeholder={t('ride.searchPh')}
                returnKeyType="search"
                onSubmitEditing={doSearch}
                containerStyle={{ flex: 1, marginBottom: 0 }}
              />
              <Button title={t('common.find')} onPress={doSearch} style={{ marginLeft: 8, height: 48, paddingHorizontal: 16, marginTop: 0 }} />
            </Row>
            <Input
              label={step === 'pickup' ? t('ride.pickupAddr') : t('ride.destAddr')}
              value={addrLoading ? '…' : address}
              onChangeText={setAddress}
              placeholder={t('ride.addrPh')}
              maxLength={200}
            />
            <ErrorText>{error}</ErrorText>
            <Row>
              {step === 'dest' ? (
                <Button kind="ghost" title={t('common.back')} onPress={() => { setStep('pickup'); backTo(pickup); }} style={{ flex: 1, marginRight: 8 }} />
              ) : step === 'pickup' && dest ? (
                <Button kind="ghost" title={t('common.back')} onPress={() => setStep('mode')} style={{ flex: 1, marginRight: 8 }} />
              ) : null}
              <Button
                title={step === 'landing' ? t('ride.seeRoutes') : step === 'pickup' && !dest ? t('ride.nextDest') : t('ride.nextConfirm')}
                onPress={confirmPoint}
                disabled={addrLoading || !(addrLoading ? true : (address || '').trim())}
                style={{ flex: 2 }}
              />
            </Row>
          </View>
        ) : (
          <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
            <Card style={{ marginBottom: 10 }}>
              <Row style={{ marginBottom: 6 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ok, marginRight: 8 }} />
                <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>{pickup ? pickup.address : ''}</Text>
              </Row>
              <Row>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger, marginRight: 8 }} />
                <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>{dest ? dest.address : ''}</Text>
              </Row>
              <Sub style={{ marginTop: 8, marginBottom: 0 }}>
                {routeLoading
                  ? t('ride.calcRoute')
                  : route
                  ? `${fmtDistance(route.distanceM)}${route.durationS ? ` · ${fmtDuration(route.durationS)}` : ''}${route.approx ? ` ${t('ride.straightLine')}` : ''} · ${t('common.freeRide')}`
                  : ''}
              </Sub>
            </Card>
            <DetailsEditor label={t('ride.pickupDetails')} value={pickupDetails} onChange={setPickupDetails} />
            <DetailsEditor label={t('ride.destDetails')} value={destDetails} onChange={setDestDetails} />
            <Input
              label={t('ride.instructions')}
              value={comment}
              onChangeText={setComment}
              placeholder={t('ride.instructionsPh')}
              maxLength={300}
            />
            <ErrorText>{error}</ErrorText>
            <Row>
              <Button kind="ghost" title={t('common.back')} onPress={() => { setStep('pickup'); setRoute(null); backTo(pickup); }} style={{ flex: 1, marginRight: 8 }} />
              <Button title={t('ride.request')} onPress={requestRide} loading={busy} disabled={routeLoading} style={{ flex: 2 }} />
            </Row>
            <SchedulePlanner
              pickup={pickup}
              dest={dest}
              comment={comment}
              onCreated={() => {
                loadSchedules();
                resetFlow();
              }}
            />
          </ScrollView>
        )}
        <View style={{ height: 12 }} />
        </FadeIn>
      </View>
    </Bleed>
  );
}

// ------------------------------------------------- scheduled rides (L14) ---

const fmtDayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Compact list of saved commutes: pause/resume and delete in place.
function ScheduleList({ schedules, onChanged }) {
  const { token } = useAuth();
  const labels = t('sched.dow').split(',');
  const fmt = (s) =>
    s.date
      ? t('sched.once', { date: s.date })
      : s.days && s.days.length === 7
      ? t('sched.daily')
      : (s.days || []).map((d) => labels[d - 1]).join(' ');
  const toggle = (s) => api('PUT', `/api/schedules/${s.id}`, { active: !s.active }, token).then(onChanged).catch(() => {});
  const del = (s) =>
    confirmAction({
      title: t('sched.deleteQ'),
      message: `${s.time} · ${s.dest.address || ''}`,
      okLabel: t('common.remove'),
      cancelLabel: t('common.cancel'),
      onOk: () => api('DELETE', `/api/schedules/${s.id}`, null, token).then(onChanged).catch(() => {}),
    });
  return (
    <Card style={{ marginBottom: 8, paddingVertical: 10 }}>
      <Text style={{ fontWeight: '700', color: colors.text, marginBottom: 6, fontSize: 13 }}>⏰ {t('sched.title')}</Text>
      {schedules.map((s) => (
        <Row key={s.id} style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <Text
            style={{ color: s.active ? colors.text : colors.sub, flexShrink: 1, fontSize: 13, marginRight: 8 }}
            numberOfLines={1}
          >
            {s.time} · {fmt(s)} · {s.dest.address || ''}
          </Text>
          <Row>
            <Pressable onPress={() => toggle(s)} style={{ paddingHorizontal: 6 }}>
              <Text style={{ fontSize: 14 }}>{s.active ? '⏸' : '▶️'}</Text>
            </Pressable>
            <Pressable onPress={() => del(s)} style={{ paddingHorizontal: 6 }}>
              <Text style={{ color: colors.danger, fontSize: 14, fontWeight: '700' }}>✕</Text>
            </Pressable>
          </Row>
        </Row>
      ))}
    </Card>
  );
}

// "Schedule instead": HH:MM + weekday chips; no days selected = once
// tomorrow. The server spawns the request ~10 minutes before departure.
function SchedulePlanner({ pickup, dest, comment, onCreated }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState('08:30');
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const labels = t('sched.dow').split(',');

  const toggleDay = (d) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const create = async () => {
    setErr('');
    setBusy(true);
    try {
      const body = { pickup, dest, comment: (comment || '').trim(), time: time.trim() };
      if (days.length) body.days = days;
      else body.date = fmtDayKey(Date.now() + 86_400_000);
      await api('POST', '/api/schedules', body, token);
      notify(t('sched.created'), t('sched.createdText'));
      setOpen(false);
      onCreated();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <Button kind="ghost" title={`⏰ ${t('sched.plan')}`} onPress={() => setOpen(true)} style={{ marginTop: 8, height: 42 }} />;
  }
  return (
    <Card style={{ marginTop: 8 }}>
      <Text style={{ fontWeight: '700', color: colors.text, marginBottom: 8 }}>⏰ {t('sched.plan')}</Text>
      <Input
        label={t('sched.timeLabel')}
        value={time}
        onChangeText={setTime}
        placeholder="08:30"
        maxLength={5}
      />
      <Text style={{ color: colors.sub, fontSize: 13, marginBottom: 6 }}>{t('sched.daysLabel')}</Text>
      <Row style={{ flexWrap: 'wrap', marginBottom: 6 }}>
        {labels.map((lb, i) => {
          const d = i + 1;
          const on = days.includes(d);
          return (
            <Pressable
              key={d}
              onPress={() => toggleDay(d)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 7,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: on ? colors.primary : colors.border,
                backgroundColor: on ? '#04222b' : colors.card,
                marginRight: 6,
                marginBottom: 6,
              }}
            >
              <Text style={{ color: on ? colors.primary : colors.sub, fontWeight: '700', fontSize: 12 }}>{lb}</Text>
            </Pressable>
          );
        })}
      </Row>
      {!days.length ? <Sub style={{ fontSize: 12 }}>{t('sched.oneOffHint')}</Sub> : null}
      <ErrorText>{err}</ErrorText>
      <Row>
        <Button kind="ghost" title={t('common.cancel')} onPress={() => setOpen(false)} style={{ flex: 1, marginRight: 8 }} />
        <Button title={t('sched.create')} onPress={create} loading={busy} style={{ flex: 2 }} />
      </Row>
    </Card>
  );
}

// Collapsible entrance/flat/floor/intercom + note block for one address.
function DetailsEditor({ label, value, onChange }) {
  const [open, setOpen] = useState(!!Object.keys(value || {}).length);
  const set = (k) => (v) => onChange({ ...value, [k]: v });
  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={{ marginBottom: 10 }}>
        <Text style={{ color: colors.sub, fontWeight: '600' }}>+ {label}</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ marginBottom: 4 }}>
      <Text style={{ color: colors.sub, fontSize: 13, marginBottom: 6 }}>{label}</Text>
      <Row>
        <Input placeholder={t('ride.entrance')} value={value.entrance || ''} onChangeText={set('entrance')} maxLength={20} containerStyle={{ flex: 1, marginRight: 6 }} />
        <Input placeholder={t('ride.apartment')} value={value.apartment || ''} onChangeText={set('apartment')} maxLength={20} containerStyle={{ flex: 1, marginRight: 6 }} />
        <Input placeholder={t('ride.floor')} value={value.floor || ''} onChangeText={set('floor')} maxLength={20} containerStyle={{ flex: 1, marginRight: 6 }} />
        <Input placeholder={t('ride.intercom')} value={value.intercom || ''} onChangeText={set('intercom')} maxLength={20} containerStyle={{ flex: 1 }} />
      </Row>
      <Input placeholder={t('ride.detailsNote')} value={value.note || ''} onChangeText={set('note')} maxLength={200} />
    </View>
  );
}

function DriverOnTheWay({ ride, driver, driverLoc, onCancel }) {
  const mapRef = useRef(null);
  const fittedRef = useRef(false);
  const [profileUserId, setProfileUserId] = useState(null);

  const inTrip = ride.status === 'in_progress';
  const target = inTrip
    ? { lat: ride.destLat, lng: ride.destLng, kind: 'dest' }
    : { lat: ride.pickupLat, lng: ride.pickupLng, kind: 'pickup' };

  useEffect(() => {
    fittedRef.current = false;
  }, [ride.status]);

  useEffect(() => {
    if (mapRef.current && driverLoc && !fittedRef.current) {
      fittedRef.current = true;
      mapRef.current.fitBounds([[driverLoc.lat, driverLoc.lng], [target.lat, target.lng]]);
    }
  }, [driverLoc, ride.status]);

  const markers = [{ id: 'target', lat: target.lat, lng: target.lng, kind: target.kind }];
  if (driverLoc) markers.push({ id: 'driver', lat: driverLoc.lat, lng: driverLoc.lng, kind: 'car' });

  const call = () => {
    if (driver && driver.phone) Linking.openURL(`tel:${driver.phone}`);
  };

  const shareRide = async () => {
    try {
      const r = await api('POST', `/api/rides/${ride.id}/share`, {}, token);
      const url = `${API_URL}${r.path}`;
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ url });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        notify(t('ride.share'), t('ride.shareCopied'));
      } else {
        await Share.share({ message: url });
      }
    } catch (e) {}
  };

  const heading =
    ride.status === 'accepted'
      ? t('ride.onTheWay')
      : ride.status === 'arrived'
      ? t('ride.arrivedTitle')
      : t('ride.onTrip');

  return (
    <Bleed top>
      <View style={{ flex: 1 }}>
        <MapView ref={mapRef} initialCenter={{ lat: target.lat, lng: target.lng }} markers={markers} />
      </View>
      <View style={{ paddingHorizontal: SCREEN_PAD, paddingTop: 10, backgroundColor: colors.bg }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 6 }}>{heading}</Text>
        <Card style={{ marginBottom: 10 }}>
          <Row style={{ marginBottom: 2 }}>
            <Pressable onPress={driver ? () => setProfileUserId(driver.id) : undefined}>
              <Avatar user={driver} size={34} style={{ marginRight: 8 }} />
            </Pressable>
            <Text
              style={{ fontSize: 16, fontWeight: '700', color: colors.text, flexShrink: 1 }}
              onPress={driver ? () => setProfileUserId(driver.id) : undefined}
            >
              {driver ? driver.name : ''}{' '}
              <Text style={{ color: colors.sub, fontWeight: '400', fontSize: 13 }}>
                {driver && driver.rating != null ? `★ ${driver.rating} (${driver.ratingCount})` : t('common.noRatings')}
              </Text>
            </Text>
          </Row>
          {driver && driver.car ? (
            <Sub style={{ marginBottom: 6 }}>
              {driver.car.color} {driver.car.make} {driver.car.model} ·{' '}
              <Text style={{ fontWeight: '700', color: colors.text }}>{driver.car.plate}</Text>
            </Sub>
          ) : null}
          <Sub style={{ marginBottom: 8 }}>
            {inTrip
              ? t('ride.headingTo', { dest: ride.destAddress })
              : ride.status === 'arrived'
              ? t('ride.waitingAtPickup')
              : t('ride.pickupLabel', { addr: ride.pickupAddress })}
          </Sub>
          <Row>
            <Button title={t('ride.callDriver')} onPress={call} style={{ flex: 1, marginRight: 8 }} />
            {!inTrip ? <Button kind="ghost" title={t('common.cancel')} onPress={onCancel} style={{ flex: 1 }} /> : null}
          </Row>
          <Button kind="ghost" title={`🔗 ${t('ride.share')}`} onPress={shareRide} style={{ marginTop: 8, height: 42 }} />
        </Card>
      </View>
      <UserProfileModal userId={profileUserId} onClose={() => setProfileUserId(null)} />
    </Bleed>
  );
}
