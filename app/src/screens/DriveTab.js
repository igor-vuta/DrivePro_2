import React, { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { notify, confirmAction } from '../dialogs';
import * as Location from 'expo-location';
import MapView from '../MapView';
import { Card, Button, Sub, StatusDot, Row, Avatar, Input, Segmented, FadeIn, colors } from '../ui';
import { useAuth } from '../state';
import { api } from '../api';
import { wsClient } from '../ws';
import UserProfileModal from '../UserProfileModal';
import { t, errMsg, getLang } from '../i18n';

// Priority: requester's points plus strong aging so nobody starves - a
// request waiting ~4 minutes outranks most point balances.
const AGING_PER_MIN = 150;
function offerScore(o, nowMs) {
  const pts = o.rider && o.rider.points ? o.rider.points : 0;
  const waitedMin = o.ride && o.ride.createdAt ? (nowMs - o.ride.createdAt) / 60000 : 0;
  return pts + waitedMin * AGING_PER_MIN;
}

function fmtKm(m) {
  if (m == null) return '';
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

// Thin the OSRM geometry before shipping it over the socket.
function simplifyPts(pts, max = 80) {
  if (!Array.isArray(pts) || pts.length <= max) return pts || [];
  const step = (pts.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

// Route lengths in km (equirectangular - fine at city scale).
function segKm(a, b) {
  const cos = Math.cos((a[0] * Math.PI) / 180);
  const dx = (b[1] - a[1]) * cos * 111.32;
  const dy = (b[0] - a[0]) * 110.54;
  return Math.hypot(dx, dy);
}
function routeTotalKm(pts) {
  let d = 0;
  for (let i = 0; i < pts.length - 1; i++) d += segKm(pts[i], pts[i + 1]);
  return d;
}
// Distance still ahead: from the projection of `cur` on the route to its end.
function remainingKm(cur, pts) {
  if (!cur || !Array.isArray(pts) || pts.length < 2) return null;
  const cos = Math.cos((cur.lat * Math.PI) / 180);
  const X = (p) => p[1] * cos * 111.32;
  const Y = (p) => p[0] * 110.54;
  const px = X([cur.lat, cur.lng]);
  const py = Y([cur.lat, cur.lng]);
  let best = Infinity;
  let bi = 0;
  let bq = pts[0];
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = X(pts[i]);
    const ay = Y(pts[i]);
    const bx = X(pts[i + 1]);
    const by = Y(pts[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    const d = Math.hypot(px - qx, py - qy);
    if (d < best) {
      best = d;
      bi = i;
      bq = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
  }
  let left = segKm(bq, pts[bi + 1]);
  for (let j = bi + 1; j < pts.length - 1; j++) left += segKm(pts[j], pts[j + 1]);
  return left;
}

function stars(user) {
  return user && user.rating != null ? `★ ${user.rating} (${user.ratingCount})` : t('common.noRatings');
}

function fmtDetails(d) {
  if (!d) return null;
  const parts = [];
  if (d.entrance) parts.push(`${t('ride.entrance')} ${d.entrance}`);
  if (d.apartment) parts.push(`${t('ride.apartment')} ${d.apartment}`);
  if (d.floor) parts.push(`${t('ride.floor')} ${d.floor}`);
  if (d.intercom) parts.push(`${t('ride.intercom')} ${d.intercom}`);
  let out = parts.join(' · ');
  if (d.note) out = out ? `${out}\n${d.note}` : d.note;
  return out || null;
}

export default function DriveTab({ openProfile }) {
  const { token, me, driverActive, activeRide, counterpart } = useAuth();
  const [busyToggle, setBusyToggle] = useState(false);
  const [coords, setCoords] = useState(null);
  const [offers, setOffers] = useState([]);
  const [acceptingId, setAcceptingId] = useState(null);
  const [profileUserId, setProfileUserId] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [routePlan, setRoutePlan] = useState(null); // { dest:{lat,lng,address}, points, radiusM }
  const [routeQuery, setRouteQuery] = useState('');
  const [routeResults, setRouteResults] = useState(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeErr, setRouteErr] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [navFollow, setNavFollow] = useState(true);
  const watchRef = useRef(null);
  const navMapRef = useRef(null);
  const pendingAcceptRef = useRef(null);
  const routeMapRef = useRef(null);

  const drivingRide = activeRide && me && activeRide.driverId === me.id ? activeRide : null;
  const ridingRide = activeRide && me && activeRide.riderId === me.id ? activeRide : null;

  // Aging re-sort tick while the feed is visible.
  useEffect(() => {
    if (!offers.length) return undefined;
    const iv = setInterval(() => setNowTick(Date.now()), 20000);
    return () => clearInterval(iv);
  }, [offers.length]);

  // Order feed subscriptions.
  useEffect(() => {
    const offOffer = wsClient.on('ride:offer', (msg) => {
      setOffers((prev) => (prev.some((o) => o.ride.id === msg.ride.id) ? prev : [msg, ...prev]));
    });
    const offGone = wsClient.on('ride:offer_gone', (msg) => {
      setOffers((prev) => prev.filter((o) => o.ride.id !== msg.rideId));
    });
    const offErr = wsClient.on('error', (msg) => {
      if (pendingAcceptRef.current) {
        const rideId = pendingAcceptRef.current;
        pendingAcceptRef.current = null;
        setAcceptingId(null);
        if (msg.code === 'taken') {
          setOffers((prev) => prev.filter((o) => o.ride.id !== rideId));
          notify(t('drive.tooLate'), t('drive.tooLateText'));
        } else {
          notify(t('drive.cannotAccept'), errMsg(msg) || t('drive.tryAgain'));
        }
      }
    });
    return () => {
      offOffer();
      offGone();
      offErr();
    };
  }, []);

  // Follow-me: keep the navigator map centered on the car while online.
  useEffect(() => {
    if (driverActive && routePlan && navFollow && coords && navMapRef.current && !drivingRide) {
      navMapRef.current.setCenter({ lat: coords.lat, lng: coords.lng, animate: true });
    }
  }, [coords ? coords.lat : null, coords ? coords.lng : null, driverActive, navFollow]);

  // Accepting resolved successfully -> ride:update set the active ride.
  useEffect(() => {
    if (drivingRide && pendingAcceptRef.current) {
      pendingAcceptRef.current = null;
      setAcceptingId(null);
      setOffers([]);
    }
  }, [drivingRide]);

  // Stream location while online (and during an active ride).
  useEffect(() => {
    let cancelled = false;
    const shouldWatch = driverActive || !!drivingRide;
    (async () => {
      if (shouldWatch && !watchRef.current) {
        try {
          const sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 15 },
            (loc) => {
              const { latitude, longitude } = loc.coords;
              setCoords({ lat: latitude, lng: longitude });
              wsClient.send({ type: 'driver:location', lat: latitude, lng: longitude });
            }
          );
          if (cancelled) sub.remove();
          else watchRef.current = sub;
        } catch (e) {
          // non-fatal
        }
      }
      if (!shouldWatch && watchRef.current) {
        watchRef.current.remove();
        watchRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
      if (watchRef.current) {
        watchRef.current.remove();
        watchRef.current = null;
      }
    };
  }, [driverActive, !!drivingRide]);

  const searchRouteDest = async () => {
    const q = routeQuery.trim();
    if (q.length < 2) return;
    setRouteErr('');
    setRouteBusy(true);
    try {
      const base = coords ? `&lat=${coords.lat}&lng=${coords.lng}` : '';
      const r = await api('GET', `/api/geo/search?q=${encodeURIComponent(q)}${base}&lang=${getLang()}`, null, token);
      setRouteResults(r.results || []);
    } catch (e) {
      setRouteErr(errMsg(e));
    } finally {
      setRouteBusy(false);
    }
  };

  const setDestination = async (rslt) => {
    setRouteErr('');
    setRouteBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        notify(t('drive.locationNeeded'), t('drive.locationNeededText'));
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const from = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      setCoords(from);
      let points = [[from.lat, from.lng], [rslt.lat, rslt.lng]];
      try {
        const r = await api(
          'GET',
          `/api/geo/route?fromLat=${from.lat}&fromLng=${from.lng}&toLat=${rslt.lat}&toLng=${rslt.lng}`,
          null,
          token
        );
        if (r.points && r.points.length >= 2) points = simplifyPts(r.points);
      } catch (e) {
        // straight-line corridor fallback
      }
      setRoutePlan((prev) => ({
        dest: { lat: rslt.lat, lng: rslt.lng, address: rslt.address },
        points,
        radiusM: prev ? prev.radiusM : 1000,
      }));
      setRouteQuery('');
      setRouteResults(null);
    } catch (e) {
      setRouteErr(errMsg(e));
    } finally {
      setRouteBusy(false);
    }
  };
  const chooseRouteDest = setDestination;

  const goOnline = async () => {
    setBusyToggle(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        notify(t('drive.locationNeeded'), t('drive.locationNeededText'));
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;
      setCoords({ lat: latitude, lng: longitude });
      const sent = wsClient.send({
        type: 'driver:activate',
        lat: latitude,
        lng: longitude,
        ...(routePlan
          ? {
              route: {
                destLat: routePlan.dest.lat,
                destLng: routePlan.dest.lng,
                destAddress: routePlan.dest.address,
                radiusM: routePlan.radiusM,
                points: routePlan.points,
              },
            }
          : {}),
      });
      if (!sent) notify(t('drive.offline'), t('drive.offlineTryAgain'));
    } catch (e) {
      notify(t('drive.error'), errMsg(e));
    } finally {
      setBusyToggle(false);
    }
  };

  const goOffline = () => {
    wsClient.send({ type: 'driver:deactivate' });
    setOffers([]);
  };

  const accept = (rideId) => {
    pendingAcceptRef.current = rideId;
    setAcceptingId(rideId);
    const ok = wsClient.send({ type: 'ride:accept', rideId });
    if (!ok) {
      pendingAcceptRef.current = null;
      setAcceptingId(null);
      notify(t('drive.offline'), t('common.offlineSend'));
    }
  };

  const dismiss = (rideId) => {
    setOffers((prev) => prev.filter((o) => o.ride.id !== rideId));
  };

  if (!me) return null;

  if (!me.isDriver) {
    return (
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 6 }}>{t('drive.become')}</Text>
        <Sub>{t('drive.becomeText')}</Sub>
        <Button title={t('drive.addCar')} onPress={openProfile} />
      </Card>
    );
  }

  if (ridingRide) {
    return (
      <Card>
        <Sub style={{ marginBottom: 0 }}>{t('drive.activeAsRider')}</Sub>
      </Card>
    );
  }

  if (drivingRide) {
    return <ActiveDriveView ride={drivingRide} rider={counterpart} myCoords={coords} token={token} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <UserProfileModal userId={profileUserId} onClose={() => setProfileUserId(null)} />
      <MapPickModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={(dest) => {
          setPickerOpen(false);
          setDestination(dest);
        }}
        initialCenter={coords || (routePlan ? routePlan.dest : { lat: 43.2389, lng: 76.8897 })}
        token={token}
      />
      <Card>
        <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>
            {driverActive ? t('drive.online') : t('drive.offline')}
          </Text>
          <StatusDot on={driverActive} labelOn={t('drive.taking')} labelOff={t('drive.notTaking')} />
        </Row>
        <Sub>{me.car ? `${me.car.color} ${me.car.make} ${me.car.model} · ${me.car.plate}` : ''}</Sub>
        {driverActive ? (
          <Button title={t('drive.goOffline')} onPress={goOffline} kind="ghost" />
        ) : (
          <Button title={t('drive.goOnline')} onPress={goOnline} loading={busyToggle} />
        )}
      </Card>

      {driverActive && routePlan ? (
        <Card style={{ padding: 10 }}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 6 }}>
            <Text style={{ fontWeight: '800', color: colors.text, fontSize: 16 }}>🧭 {t('drive.navTitle')}</Text>
            <Pressable onPress={() => setNavFollow((f) => !f)} hitSlop={10}>
              <Text style={{ color: navFollow ? colors.primary : colors.sub, fontWeight: '700', fontSize: 13 }}>
                🎯 {t('drive.navFollow')}
              </Text>
            </Pressable>
          </Row>
          <View style={{ height: 230, borderRadius: 12, overflow: 'hidden', marginBottom: 10 }}>
            <MapView
              ref={navMapRef}
              initialCenter={coords || routePlan.dest}
              initialZoom={15}
              markers={[
                ...(coords ? [{ id: 'me', lat: coords.lat, lng: coords.lng, kind: 'car' }] : []),
                { id: 'dest', lat: routePlan.dest.lat, lng: routePlan.dest.lng, kind: 'dest' },
              ]}
              polyline={routePlan.points}
            />
          </View>
          {(() => {
            const left = remainingKm(coords, routePlan.points);
            const total = routeTotalKm(routePlan.points);
            const pct = left != null && total > 0 ? Math.max(0, Math.min(100, Math.round((1 - left / total) * 100))) : 0;
            return (
              <View style={{ paddingHorizontal: 6 }}>
                <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>
                    {left != null ? t('drive.navLeft', { km: left.toFixed(1) }) : '…'}
                  </Text>
                  <Text style={{ color: colors.sub }}>
                    {left != null ? t('drive.navEta', { min: Math.max(1, Math.round(left * 2.1)) }) : ''}
                  </Text>
                </Row>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: '#0a0e1a', overflow: 'hidden', marginBottom: 6 }}>
                  <View
                    style={{
                      width: `${pct}%`,
                      height: 6,
                      backgroundColor: colors.primary,
                      borderRadius: 3,
                      shadowColor: colors.primary,
                      shadowOpacity: 0.8,
                      shadowRadius: 6,
                      shadowOffset: { width: 0, height: 0 },
                    }}
                  />
                </View>
                <Sub style={{ marginBottom: 2 }}>
                  {t('drive.to', { addr: routePlan.dest.address })} · {t('drive.routeCorridor')} {fmtKm(routePlan.radiusM)}
                </Sub>
              </View>
            );
          })()}
        </Card>
      ) : null}

      {!driverActive ? (
        <Card>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 }}>{t('drive.routeTitle')}</Text>
          <Sub>{routePlan ? t('drive.routeSet') : t('drive.routeHint')}</Sub>
          {routePlan ? (
            <View>
              <Sub style={{ marginBottom: 8 }}>{t('drive.to', { addr: routePlan.dest.address })}</Sub>
              <View style={{ height: 170, borderRadius: 12, overflow: 'hidden', marginBottom: 10 }}>
                <MapView
                  key={`${routePlan.dest.lat},${routePlan.dest.lng}`}
                  ref={routeMapRef}
                  initialCenter={{ lat: routePlan.dest.lat, lng: routePlan.dest.lng }}
                  markers={[
                    ...(coords ? [{ id: 'me', lat: coords.lat, lng: coords.lng, kind: 'car' }] : []),
                    { id: 'dest', lat: routePlan.dest.lat, lng: routePlan.dest.lng, kind: 'dest' },
                  ]}
                  polyline={routePlan.points}
                  onReady={() => {
                    if (routeMapRef.current && routePlan.points.length >= 2) routeMapRef.current.fitBounds(routePlan.points);
                  }}
                />
              </View>
              <Sub style={{ marginBottom: 4 }}>{t('drive.routeCorridor')}</Sub>
              <Segmented
                value={routePlan.radiusM}
                onChange={(v) => setRoutePlan((p) => (p ? { ...p, radiusM: v } : p))}
                options={[
                  { value: 200, label: '200 m' },
                  { value: 500, label: '500 m' },
                  { value: 1000, label: '1 km' },
                  { value: 2000, label: '2 km' },
                ]}
              />
              <Button kind="ghost" title={t('drive.routeClear')} onPress={() => setRoutePlan(null)} style={{ marginTop: 8 }} />
            </View>
          ) : (
            <View>
              <Row>
                <Input
                  value={routeQuery}
                  onChangeText={setRouteQuery}
                  placeholder={t('drive.routeSearchPh')}
                  returnKeyType="search"
                  onSubmitEditing={searchRouteDest}
                  containerStyle={{ flex: 1, marginBottom: 0 }}
                />
                <Button
                  title={t('common.find')}
                  onPress={searchRouteDest}
                  loading={routeBusy}
                  style={{ marginLeft: 8, height: 48, paddingHorizontal: 16, marginTop: 0 }}
                />
              </Row>
              {routeResults
                ? routeResults.map((r, i) => (
                    <Pressable
                      key={i}
                      onPress={() => chooseRouteDest(r)}
                      style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border }}
                    >
                      <Text style={{ color: colors.text }}>{r.address}</Text>
                      <Text style={{ color: colors.sub, fontSize: 12 }} numberOfLines={1}>
                        {r.fullAddress}
                      </Text>
                    </Pressable>
                  ))
                : null}
              {routeResults && !routeResults.length ? <Sub>{t('ride.nothingFound')}</Sub> : null}
              {routeErr ? <Sub style={{ color: colors.danger }}>{routeErr}</Sub> : null}
              <Button kind="ghost" title={`🗺 ${t('drive.routePickMap')}`} onPress={() => setPickerOpen(true)} style={{ marginTop: 8 }} />
            </View>
          )}
        </Card>
      ) : null}

      {driverActive ? (
        offers.length === 0 ? (
          <Card>
            <Sub style={{ marginBottom: 0 }}>{t('drive.waiting')}</Sub>
          </Card>
        ) : (
          <ScrollView>
            {[...offers].sort((a, b) => offerScore(b, nowTick) - offerScore(a, nowTick)).map((o) => (
              <FadeIn key={o.ride.id} keyId={o.ride.id} from={22}>
              <Card>
                <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <Row style={{ flex: 1, marginRight: 8 }}>
                    <Pressable onPress={o.rider ? () => setProfileUserId(o.rider.id) : undefined}>
                      <Avatar user={o.rider} size={34} style={{ marginRight: 8 }} />
                    </Pressable>
                    <Text
                      style={{ fontSize: 16, fontWeight: '700', color: colors.text, flexShrink: 1 }}
                      onPress={o.rider ? () => setProfileUserId(o.rider.id) : undefined}
                    >
                      {o.rider ? o.rider.name : ''}{' '}
                      <Text style={{ color: colors.sub, fontWeight: '400', fontSize: 13 }}>{stars(o.rider)}</Text>
                      {o.rider && o.rider.points >= 100 ? (
                        <Text style={{ color: colors.gold, fontWeight: '700', fontSize: 13 }}>  ⚡{o.rider.points}</Text>
                      ) : null}
                    </Text>
                  </Row>
                  {o.pickupDistanceM != null ? (
                    <Text style={{ color: colors.sub, fontSize: 13 }}>{t('drive.away', { d: fmtKm(o.pickupDistanceM) })}</Text>
                  ) : null}
                </Row>
                <Row style={{ marginBottom: 4 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ok, marginRight: 8 }} />
                  <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>{o.ride.pickupAddress}</Text>
                </Row>
                {fmtDetails(o.ride.pickupDetails) ? (
                  <Sub style={{ marginBottom: 4, marginLeft: 16 }}>{fmtDetails(o.ride.pickupDetails)}</Sub>
                ) : null}
                <Row style={{ marginBottom: 4 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger, marginRight: 8 }} />
                  <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>{o.ride.destAddress}</Text>
                </Row>
                {fmtDetails(o.ride.destDetails) ? (
                  <Sub style={{ marginBottom: 4, marginLeft: 16 }}>{fmtDetails(o.ride.destDetails)}</Sub>
                ) : null}
                <Sub style={{ marginBottom: 6 }}>
                  {t('drive.trip', { d: fmtKm(o.ride.distanceM) })} · {t('common.freeRide')}
                  {o.ride.createdAt && nowTick - o.ride.createdAt > 120000 ? ` · ${t('drive.waitingFor', { m: Math.round((nowTick - o.ride.createdAt) / 60000) })}` : ''}
                  {o.ride.comment ? `\n“${o.ride.comment}”` : ''}
                </Sub>
                <Row>
                  <Button kind="ghost" title={t('drive.dismiss')} onPress={() => dismiss(o.ride.id)} style={{ flex: 1, marginRight: 8 }} />
                  <Button
                    title={t('drive.accept')}
                    onPress={() => accept(o.ride.id)}
                    loading={acceptingId === o.ride.id}
                    disabled={!!acceptingId && acceptingId !== o.ride.id}
                    style={{ flex: 2 }}
                  />
                </Row>
              </Card>
              </FadeIn>
            ))}
          </ScrollView>
        )
      ) : null}
    </View>
  );
}

function ActiveDriveView({ ride, rider, myCoords, token }) {
  const mapRef = useRef(null);
  const [route, setRoute] = useState(null);
  const [busyAction, setBusyAction] = useState(false);
  const [profileUserId, setProfileUserId] = useState(null);
  const [follow, setFollow] = useState(true);
  const fittedRef = useRef(false);

  const inTrip = ride.status === 'in_progress';
  const target = inTrip
    ? { lat: ride.destLat, lng: ride.destLng, kind: 'dest' }
    : { lat: ride.pickupLat, lng: ride.pickupLng, kind: 'pickup' };

  // New status -> new leg: clear the route, refit the map, unlock buttons.
  useEffect(() => {
    setRoute(null);
    fittedRef.current = false;
    setBusyAction(false);
  }, [ride.status, ride.id]);

  // Route from the driver's position to the current target.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!myCoords || route) return;
      try {
        const r = await api(
          'GET',
          `/api/geo/route?fromLat=${myCoords.lat}&fromLng=${myCoords.lng}&toLat=${target.lat}&toLng=${target.lng}`,
          null,
          token
        );
        if (!cancelled) setRoute(r);
      } catch (e) {
        // straight line fallback drawn below
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [myCoords, ride.id, ride.status, route]);

  useEffect(() => {
    if (mapRef.current && myCoords && !fittedRef.current) {
      fittedRef.current = true;
      mapRef.current.fitBounds([[myCoords.lat, myCoords.lng], [target.lat, target.lng]]);
    }
  }, [myCoords, ride.status]);

  // Follow-me during the ride: keep the car centered as it moves.
  useEffect(() => {
    if (follow && fittedRef.current && myCoords && mapRef.current) {
      mapRef.current.setCenter({ lat: myCoords.lat, lng: myCoords.lng, animate: true });
    }
  }, [myCoords ? myCoords.lat : null, myCoords ? myCoords.lng : null, follow]);

  const markers = [{ id: 'target', lat: target.lat, lng: target.lng, kind: target.kind }];
  if (myCoords) markers.push({ id: 'me', lat: myCoords.lat, lng: myCoords.lng, kind: 'car' });

  const polyline = route
    ? route.points
    : myCoords
    ? [[myCoords.lat, myCoords.lng], [target.lat, target.lng]]
    : null;

  const call = () => {
    if (rider && rider.phone) Linking.openURL(`tel:${rider.phone}`);
  };

  const cancel = () => {
    confirmAction({
      title: t('ride.cancelQ'),
      message: t('drive.riderNotified'),
      okLabel: t('ride.cancelRide'),
      cancelLabel: t('ride.keepRide'),
      onOk: () => wsClient.send({ type: 'ride:cancel', rideId: ride.id }),
    });
  };

  const act = (type) => {
    setBusyAction(true);
    const ok = wsClient.send({ type, rideId: ride.id });
    if (!ok) {
      setBusyAction(false);
      notify(t('drive.offline'), t('common.offlineSend'));
    }
  };

  const heading =
    ride.status === 'accepted' ? t('drive.headPickup') : ride.status === 'arrived' ? t('drive.waitingRider') : t('drive.onTrip');
  const mainAction =
    ride.status === 'accepted'
      ? { title: t('drive.arrived'), type: 'ride:arrived' }
      : ride.status === 'arrived'
      ? { title: t('drive.start'), type: 'ride:start' }
      : { title: t('drive.finish'), type: 'ride:finish' };

  return (
    <View style={{ flex: 1, marginHorizontal: -16 }}>
      <View style={{ flex: 1 }}>
        <MapView ref={mapRef} initialCenter={{ lat: target.lat, lng: target.lng }} markers={markers} polyline={polyline} />
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.bg }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>{heading}</Text>
          <Row>
            {route && route.points && myCoords ? (
              <Text style={{ color: colors.sub, marginRight: 12, fontSize: 13 }}>
                {t('drive.navLeft', { km: (remainingKm(myCoords, route.points) ?? 0).toFixed(1) })}
              </Text>
            ) : null}
            <Pressable onPress={() => setFollow((f) => !f)} hitSlop={10}>
              <Text style={{ color: follow ? colors.primary : colors.sub, fontWeight: '700', fontSize: 15 }}>🎯</Text>
            </Pressable>
          </Row>
        </Row>
        <Card style={{ marginBottom: 10 }}>
          <Row style={{ marginBottom: 2 }}>
            <Pressable onPress={rider ? () => setProfileUserId(rider.id) : undefined}>
              <Avatar user={rider} size={34} style={{ marginRight: 8 }} />
            </Pressable>
            <Text
              style={{ fontSize: 16, fontWeight: '700', color: colors.text, flexShrink: 1 }}
              onPress={rider ? () => setProfileUserId(rider.id) : undefined}
            >
              {rider ? rider.name : ''}{' '}
              <Text style={{ color: colors.sub, fontWeight: '400', fontSize: 13 }}>{stars(rider)}</Text>
            </Text>
          </Row>
          <Sub style={{ marginBottom: 6 }}>
            {inTrip ? t('drive.to', { addr: ride.destAddress }) : `${ride.pickupAddress} → ${ride.destAddress}`}
          </Sub>
          {fmtDetails(inTrip ? ride.destDetails : ride.pickupDetails) ? (
            <Sub style={{ marginBottom: 6 }}>{fmtDetails(inTrip ? ride.destDetails : ride.pickupDetails)}</Sub>
          ) : null}
          {ride.comment && !inTrip ? <Sub style={{ marginBottom: 6 }}>“{ride.comment}”</Sub> : null}
          <Button title={mainAction.title} onPress={() => act(mainAction.type)} loading={busyAction} />
          <Row style={{ marginTop: 8 }}>
            <Button kind="ghost" title={t('drive.callRider')} onPress={call} style={{ flex: 1, marginRight: inTrip ? 0 : 8 }} />
            {!inTrip ? <Button kind="ghost" title={t('common.cancel')} onPress={cancel} style={{ flex: 1 }} /> : null}
          </Row>
        </Card>
      </View>
      <UserProfileModal userId={profileUserId} onClose={() => setProfileUserId(null)} />
    </View>
  );
}

// Fullscreen center-pin destination picker for the driver's route.
function MapPickModal({ visible, onClose, onConfirm, initialCenter, token }) {
  const [addr, setAddr] = useState('');
  const [c, setC] = useState(initialCenter);
  const seqRef = useRef(0);

  useEffect(() => {
    if (visible) {
      setC(initialCenter);
      setAddr('');
      lookup(initialCenter);
    }
  }, [visible]);

  const lookup = async (pt) => {
    const seq = ++seqRef.current;
    try {
      const r = await api('GET', `/api/geo/reverse?lat=${pt.lat}&lng=${pt.lng}&lang=${getLang()}`, null, token);
      if (seq === seqRef.current) setAddr(r.address || `${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`);
    } catch (e) {
      if (seq === seqRef.current) setAddr(`${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`);
    }
  };

  if (!visible) return null;
  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ flex: 1 }}>
          <MapView
            initialCenter={initialCenter}
            initialZoom={14}
            onMoveEnd={(pt) => {
              const p = { lat: pt.lat, lng: pt.lng };
              setC(p);
              lookup(p);
            }}
          />
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}
          >
            <View style={{ alignItems: 'center', marginBottom: 34 }}>
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: colors.danger,
                  borderWidth: 3,
                  borderColor: '#e9f2ff',
                  shadowColor: colors.danger,
                  shadowOpacity: 0.9,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 0 },
                }}
              />
              <View style={{ width: 2, height: 14, backgroundColor: '#e9f2ff' }} />
            </View>
          </View>
        </View>
        <View style={{ padding: 16, backgroundColor: colors.bg }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: 4 }}>{t('drive.pickDestTitle')}</Text>
          <Sub>{addr || '…'}</Sub>
          <Button
            title={t('drive.confirmDest')}
            onPress={() => onConfirm({ ...c, address: addr || `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}` })}
          />
          <Button kind="ghost" title={t('common.cancel')} onPress={onClose} style={{ marginTop: 8 }} />
        </View>
      </View>
    </Modal>
  );
}
