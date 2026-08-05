import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { confirmAction } from '../dialogs';
import * as Location from 'expo-location';
import MapView from '../MapView';
import { Card, Button, Input, Sub, ErrorText, Row, Avatar, colors } from '../ui';
import { useAuth } from '../state';
import { api } from '../api';
import { wsClient } from '../ws';
import UserProfileModal from '../UserProfileModal';
import { t, errMsg, getLang } from '../i18n';

// Almaty, Kazakhstan - used until real geolocation arrives.
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

export default function RideTab() {
  const { token, me, activeRide, counterpart, driverLoc } = useAuth();
  const mapRef = useRef(null);

  const myRide = activeRide && me && activeRide.riderId === me.id ? activeRide : null;
  const drivingElsewhere = activeRide && me && activeRide.driverId === me.id;
  const searching = myRide && myRide.status === 'requested';
  const matched = myRide && myRide.status !== 'requested';

  const [step, setStep] = useState('pickup'); // pickup | dest | confirm
  const [center, setCenter] = useState(FALLBACK_CENTER);
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
  const geoSeq = useRef(0);

  // Center on the user's real location once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const c = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setCenter(c);
        if (mapRef.current) mapRef.current.setCenter({ ...c, zoom: 16, animate: false });
        wsClient.send({ type: 'map:watch', ...c });
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
    if (step === 'pickup' || step === 'dest') {
      reverseLookup(c);
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

  const pickResult = (r) => {
    setResults(null);
    setQuery('');
    setAddress(r.address);
    if (mapRef.current) mapRef.current.setCenter({ lat: r.lat, lng: r.lng, zoom: 16 });
  };

  const goPlace = (p) => {
    setAddress(p.address);
    if (mapRef.current) mapRef.current.setCenter({ lat: p.lat, lng: p.lng, zoom: 16 });
  };

  const confirmPoint = async () => {
    const point = { ...center, address: address.trim() || `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}` };
    if (step === 'pickup') {
      setPickup(point);
      setStep('dest');
      setAddress('');
      reverseLookup(center);
    } else if (step === 'dest') {
      setDest(point);
      setStep('confirm');
      loadRoute(pickup, point);
    }
  };

  const loadRoute = async (from, to) => {
    setRouteLoading(true);
    setRoute(null);
    try {
      const r = await api(
        'GET',
        `/api/geo/route?fromLat=${from.lat}&fromLng=${from.lng}&toLat=${to.lat}&toLng=${to.lng}`,
        null,
        token
      );
      setRoute({ ...r, approx: false });
      if (mapRef.current) mapRef.current.fitBounds(r.points.length ? r.points : [[from.lat, from.lng], [to.lat, to.lng]]);
    } catch (e) {
      const d = haversineM(from, to);
      setRoute({ distanceM: d, durationS: null, points: [[from.lat, from.lng], [to.lat, to.lng]], approx: true });
      if (mapRef.current) mapRef.current.fitBounds([[from.lat, from.lng], [to.lat, to.lng]]);
    } finally {
      setRouteLoading(false);
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
    setStep('pickup');
    setPickup(null);
    setDest(null);
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
    if (dest && step === 'confirm') list.push({ id: 'dest', lat: dest.lat, lng: dest.lng, kind: 'dest' });
    return list;
  }, [cars, pickup, dest, step]);

  const polyline = step === 'confirm' && route ? route.points : null;

  // ---------------------------------------------------------------- render

  if (drivingElsewhere) {
    return (
      <Card>
        <Sub style={{ marginBottom: 0 }}>{t('ride.activeAsDriver')}</Sub>
      </Card>
    );
  }

  if (matched) {
    return <DriverOnTheWay ride={myRide} driver={counterpart} driverLoc={driverLoc} onCancel={cancelRide} />;
  }

  if (searching) {
    return (
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
    );
  }

  const pinColor = step === 'dest' ? colors.danger : colors.ok;
  const stepTitle = step === 'pickup' ? t('ride.setPickup') : step === 'dest' ? t('ride.setDest') : t('ride.confirm');
  const places = me && me.places ? me.places : null;

  return (
    <View style={{ flex: 1, marginHorizontal: -16 }}>
      <View style={{ flex: 1 }}>
        <MapView
          ref={mapRef}
          initialCenter={center}
          initialZoom={15}
          markers={markers}
          polyline={polyline}
          onMoveEnd={onMoveEnd}
        />
        {step !== 'confirm' ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ alignItems: 'center', marginBottom: 34 }}>
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: pinColor, borderWidth: 3, borderColor: '#fff', elevation: 4, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }} />
              <View style={{ width: 3, height: 14, backgroundColor: pinColor }} />
            </View>
          </View>
        ) : null}
        {results ? (
          <View style={{ position: 'absolute', left: 12, right: 12, top: 8 }}>
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

      <View style={{ paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.bg }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 8 }}>{stepTitle}</Text>

        {step !== 'confirm' ? (
          <View>
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
                <Button kind="ghost" title={t('common.back')} onPress={() => { setStep('pickup'); setAddress(pickup ? pickup.address : ''); }} style={{ flex: 1, marginRight: 8 }} />
              ) : null}
              <Button
                title={step === 'pickup' ? t('ride.nextDest') : t('ride.nextConfirm')}
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
              <Button kind="ghost" title={t('common.back')} onPress={() => { setStep('dest'); setRoute(null); setAddress(dest ? dest.address : ''); }} style={{ flex: 1, marginRight: 8 }} />
              <Button title={t('ride.request')} onPress={requestRide} loading={busy} disabled={routeLoading} style={{ flex: 2 }} />
            </Row>
          </ScrollView>
        )}
        <View style={{ height: 12 }} />
      </View>
    </View>
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

  const heading =
    ride.status === 'accepted'
      ? t('ride.onTheWay')
      : ride.status === 'arrived'
      ? t('ride.arrivedTitle')
      : t('ride.onTrip');

  return (
    <View style={{ flex: 1, marginHorizontal: -16 }}>
      <View style={{ flex: 1 }}>
        <MapView ref={mapRef} initialCenter={{ lat: target.lat, lng: target.lng }} markers={markers} />
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.bg }}>
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
            <Button title={t('ride.callDriver')} onPress={call} style={{ flex: 1, marginRight: inTrip ? 0 : 8 }} />
            {!inTrip ? <Button kind="ghost" title={t('common.cancel')} onPress={onCancel} style={{ flex: 1 }} /> : null}
          </Row>
        </Card>
      </View>
      <UserProfileModal userId={profileUserId} onClose={() => setProfileUserId(null)} />
    </View>
  );
}
