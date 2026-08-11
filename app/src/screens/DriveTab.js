import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Linking, Platform, Pressable, ScrollView, StyleSheet, Text,
  useWindowDimensions, Vibration, View,
} from 'react-native';
import { notify, confirmAction } from '../dialogs';
import * as Location from 'expo-location';
import MapView from '../MapView';
import { Card, Button, Sub, Row, Avatar, FadeIn, Pop, Chip, Bleed, SCREEN_PAD, CHROME_H, colors } from '../ui';
import { useAuth } from '../state';
import { api } from '../api';
import { wsClient } from '../ws';
import UserProfileModal from '../UserProfileModal';
import { t, errMsg, getLang } from '../i18n';
import { stopWatching } from '../location';

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
function segKm(a, b) {
  const cos = Math.cos((a[0] * Math.PI) / 180);
  const dx = (b[1] - a[1]) * cos * 111.32;
  const dy = (b[0] - a[0]) * 110.54;
  return Math.hypot(dx, dy);
}
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

const SHEET_PEEK = 54; // header height when collapsed

const makeSt = () =>
  StyleSheet.create({
  topChips: {
    position: 'absolute',
    // The online map bleeds under the home screen's floating chrome, so the
    // driver's controls start below it rather than under the avatar.
    top: CHROME_H + 10,
    left: SCREEN_PAD,
    right: SCREEN_PAD,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // Sits just above the collapsed sheet so the two never overlap.
  navStrip: {
    position: 'absolute',
    left: SCREEN_PAD,
    right: SCREEN_PAD,
    bottom: SHEET_PEEK + 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 10,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
  },
  sheetHeader: {
    height: SHEET_PEEK,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SCREEN_PAD,
  },
  grabber: {
    width: 34,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginRight: 10,
  },
  });

// Rebuilt on every render so a scheme change is picked up; the sheet is
// cheap and this screen renders rarely.
const st = new Proxy(
  {},
  {
    get(_t, key) {
      return makeSt()[key];
    },
  }
);

// Offers panel that floats over the driver's map instead of pushing it off
// screen. Collapsed it is a header showing the count; tapping expands it to a
// scrollable list. Height is animated (not a native-driver property, hence
// useNativeDriver:false) so arriving offers and the panel feel like one motion.
function OfferSheet({ count, expanded, onToggle, children }) {
  const { height: winH } = useWindowDimensions();
  const maxH = Math.max(180, Math.round(winH * 0.5));
  const open = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(open, {
      toValue: expanded ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [expanded, maxH]);

  const label = count === 0 ? t('drive.waiting') : t('drive.offerCount', { n: count });
  return (
    <View style={[st.sheet, { paddingBottom: Platform.OS === 'web' ? 'env(safe-area-inset-bottom, 0px)' : 0 }]}>
      <Pressable onPress={count === 0 ? undefined : onToggle} style={st.sheetHeader}>
        <View style={st.grabber} />
        <Text style={{ color: count ? colors.gold : colors.sub, fontWeight: '800', fontSize: 15, flex: 1 }}>
          {count ? '⚡ ' : ''}
          {label}
        </Text>
        {count ? (
          <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15 }}>{expanded ? '▼' : '▲'}</Text>
        ) : null}
      </Pressable>
      {/* maxHeight, not height: one offer takes one card's worth of screen and
          the map keeps the rest, while a long list still stops at half. */}
      <Animated.View
        style={{ maxHeight: open.interpolate({ inputRange: [0, 1], outputRange: [0, maxH] }), overflow: 'hidden' }}
      >
        <ScrollView contentContainerStyle={{ paddingHorizontal: SCREEN_PAD, paddingBottom: 12 }}>{children}</ScrollView>
      </Animated.View>
    </View>
  );
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
  const { token, me, driverActive, activeRide, driverRides } = useAuth();
  const [coords, setCoords] = useState(null);
  const [offers, setOffers] = useState([]);
  const [acceptingId, setAcceptingId] = useState(null);
  const [profileUserId, setProfileUserId] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [sheetOpen, setSheetOpen] = useState(false);
  const watchRef = useRef(null);
  const navMapRef = useRef(null);
  const pendingAcceptRef = useRef(null);

  const convoy = driverRides || [];
  const drivingRide = convoy.length ? convoy[0].ride : null;
  const ridingRide = activeRide && me && activeRide.riderId === me.id ? activeRide : null;

  // Aging re-sort tick while the feed is visible.
  useEffect(() => {
    if (!offers.length) return undefined;
    const iv = setInterval(() => setNowTick(Date.now()), 20000);
    return () => clearInterval(iv);
  }, [offers.length]);

  const convoyRef = useRef(0);
  useEffect(() => {
    convoyRef.current = convoy.length;
  }, [convoy.length]);

  // Nothing left to show: collapse so the map gets the space back.
  useEffect(() => {
    if (!offers.length) setSheetOpen(false);
  }, [offers.length]);

  // Order feed subscriptions.
  useEffect(() => {
    const offOffer = wsClient.on('ride:offer', (msg) => {
      let added = false;
      setOffers((prev) => {
        if (prev.some((o) => o.ride.id === msg.ride.id)) return prev;
        added = true;
        return [msg, ...prev];
      });
      if (!added) return;
      // The offers panel sits collapsed over the map, so a new rider has to
      // announce itself: buzz, and pop the panel open the first time.
      Vibration.vibrate(convoyRef.current > 0 ? [0, 250, 120, 250] : 200);
      setSheetOpen(true);
      // Mid-convoy the driver is looking at the road, not the phone.
      if (convoyRef.current > 0) {
        notify(`⚡ ${t('drive.newAlong')}`, `${msg.ride.pickupAddress || ''} → ${msg.ride.destAddress || ''}`);
      }
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

  // Accepting resolved successfully -> the ride joined the convoy.
  useEffect(() => {
    const pending = pendingAcceptRef.current;
    if (pending && convoy.some((x) => x.ride.id === pending)) {
      pendingAcceptRef.current = null;
      setAcceptingId(null);
      setOffers((prev) => prev.filter((o) => o.ride.id !== pending));
    }
  }, [convoy.length]);

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
          if (cancelled) stopWatching(sub);
          else watchRef.current = sub;
        } catch (e) {
          // non-fatal
        }
      }
      if (!shouldWatch && watchRef.current) {
        stopWatching(watchRef.current);
        watchRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
      if (watchRef.current) {
        stopWatching(watchRef.current);
        watchRef.current = null;
      }
    };
  }, [driverActive, !!drivingRide]);

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

  const offerCards = [...offers].sort((a, b) => offerScore(b, nowTick) - offerScore(a, nowTick)).map((o) => (
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
            ));

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

  return (
    <View style={{ flex: 1 }}>
      <UserProfileModal userId={profileUserId} onClose={() => setProfileUserId(null)} />
      {convoy.length ? (
        // Carrying passengers: the convoy map owns the screen and offers stay
        // one tap away in the sheet instead of below the fold.
        <Pop keyId={`convoy-${convoy.length}`}>
          <View style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={{ paddingBottom: SHEET_PEEK + 12 }}>
              <ConvoyView rides={convoy} myCoords={coords} token={token} openProfile={setProfileUserId} />
            </ScrollView>
            <OfferSheet count={offers.length} expanded={sheetOpen} onToggle={() => setSheetOpen((v) => !v)}>
              {offerCards}
            </OfferSheet>
          </View>
        </Pop>
      ) : driverActive ? (
        // Online and free: full-screen navigator, controls floating over it.
        <Pop keyId="online">
          <Bleed top>
            <MapView
              ref={navMapRef}
              initialCenter={coords || { lat: 43.2389, lng: 76.8897 }}
              initialZoom={15}
              markers={coords ? [{ id: 'me', lat: coords.lat, lng: coords.lng, kind: 'car' }] : []}
            />

            <View style={st.topChips} pointerEvents="box-none">
              <Chip tone="active">{`● ${t('drive.taking')}`}</Chip>
              <Chip tone="danger" onPress={goOffline}>
                {`⏻ ${t('drive.goOffline')}`}
              </Chip>
            </View>

            <OfferSheet count={offers.length} expanded={sheetOpen} onToggle={() => setSheetOpen((v) => !v)}>
              {offerCards}
            </OfferSheet>
          </Bleed>
        </Pop>
      ) : (
        // Reached only in the moment between accepting a ride and the
        // convoy arriving from the server. Going online, choosing a route and
        // setting a corridor all used to live here, in a second driver window
        // that duplicated the ride flow; L42 moved them onto your own route
        // and this stopped being somewhere anyone should end up.
        <Card>
          <Sub style={{ marginBottom: 0 }}>{t('drive.loadingRide')}</Sub>
        </Card>
      )}
    </View>
  );
}

// Convoy: the driver's live view while carrying 1-3 passengers - one map
// with every target, per-passenger status controls, follow-me and remaining km.
function ConvoyView({ rides, myCoords, token, openProfile }) {
  const mapRef = useRef(null);
  const [route, setRoute] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [follow, setFollow] = useState(true);
  const fittedRef = useRef(false);

  const targetFor = (r) =>
    r.status === 'in_progress'
      ? { lat: r.destLat, lng: r.destLng, kind: 'dest' }
      : { lat: r.pickupLat, lng: r.pickupLng, kind: 'pickup' };
  const first = rides[0];
  const target = targetFor(first.ride);
  const statuses = rides.map((x) => x.ride.status).join(',');

  // New leg for the lead ride -> new route + refit; any status change unlocks buttons.
  useEffect(() => {
    setRoute(null);
    fittedRef.current = false;
  }, [first.ride.id, first.ride.status]);
  useEffect(() => {
    setBusyId(null);
  }, [statuses, rides.length]);

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
        // straight line fallback below
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [myCoords, first.ride.id, first.ride.status, route]);

  useEffect(() => {
    if (mapRef.current && myCoords && !fittedRef.current) {
      fittedRef.current = true;
      mapRef.current.fitBounds([
        [myCoords.lat, myCoords.lng],
        ...rides.map((x) => {
          const tg = targetFor(x.ride);
          return [tg.lat, tg.lng];
        }),
      ]);
    }
  }, [myCoords, rides.length, first.ride.status]);

  // Follow-me while driving the convoy.
  useEffect(() => {
    if (follow && fittedRef.current && myCoords && mapRef.current) {
      mapRef.current.setCenter({ lat: myCoords.lat, lng: myCoords.lng, animate: true });
    }
  }, [myCoords ? myCoords.lat : null, myCoords ? myCoords.lng : null, follow]);

  const markers = rides.map((x) => {
    const tg = targetFor(x.ride);
    return { id: `t-${x.ride.id}`, lat: tg.lat, lng: tg.lng, kind: tg.kind };
  });
  if (myCoords) markers.push({ id: 'me', lat: myCoords.lat, lng: myCoords.lng, kind: 'car' });
  const polyline = route
    ? route.points
    : myCoords
    ? [[myCoords.lat, myCoords.lng], [target.lat, target.lng]]
    : null;

  const act = (type, rideId) => {
    setBusyId(rideId);
    const ok = wsClient.send({ type, rideId });
    if (!ok) {
      setBusyId(null);
      notify(t('drive.offline'), t('common.offlineSend'));
    }
  };
  const cancelRide = (rideId) => {
    confirmAction({
      title: t('ride.cancelQ'),
      message: t('drive.riderNotified'),
      okLabel: t('ride.cancelRide'),
      cancelLabel: t('ride.keepRide'),
      onOk: () => wsClient.send({ type: 'ride:cancel', rideId }),
    });
  };

  return (
    <View>
      <Card style={{ padding: 10 }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 6 }}>
          <Text style={{ fontWeight: '800', color: colors.text, fontSize: 16 }}>
            🚗 {t('drive.convoyTitle', { n: rides.length })}
          </Text>
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
        <View style={{ height: 250, borderRadius: 12, overflow: 'hidden' }}>
          <MapView ref={mapRef} initialCenter={{ lat: target.lat, lng: target.lng }} markers={markers} polyline={polyline} />
        </View>
      </Card>

      {rides.map(({ ride, rider }, idx) => {
        const inTrip = ride.status === 'in_progress';
        const heading =
          ride.status === 'accepted'
            ? t('drive.headPickup')
            : ride.status === 'arrived'
            ? t('drive.waitingRider')
            : t('drive.onTrip');
        const mainAction =
          ride.status === 'accepted'
            ? { title: t('drive.arrived'), type: 'ride:arrived' }
            : ride.status === 'arrived'
            ? { title: t('drive.start'), type: 'ride:start' }
            : { title: t('drive.finish'), type: 'ride:finish' };
        return (
          <FadeIn key={ride.id} keyId={ride.id} from={16}>
            <Card>
              <Row style={{ marginBottom: 2 }}>
                <Pressable onPress={rider ? () => openProfile(rider.id) : undefined}>
                  <Avatar user={rider} size={34} style={{ marginRight: 8 }} />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ fontSize: 15, fontWeight: '700', color: colors.text }}
                    onPress={rider ? () => openProfile(rider.id) : undefined}
                  >
                    {idx + 1}. {rider ? rider.name : ''}{' '}
                    <Text style={{ color: colors.sub, fontWeight: '400', fontSize: 12 }}>{stars(rider)}</Text>
                  </Text>
                  <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>{heading}</Text>
                </View>
              </Row>
              <Sub style={{ marginBottom: 6 }}>
                {inTrip ? t('drive.to', { addr: ride.destAddress }) : `${ride.pickupAddress} → ${ride.destAddress}`}
              </Sub>
              {fmtDetails(inTrip ? ride.destDetails : ride.pickupDetails) ? (
                <Sub style={{ marginBottom: 6 }}>{fmtDetails(inTrip ? ride.destDetails : ride.pickupDetails)}</Sub>
              ) : null}
              {ride.comment && !inTrip ? <Sub style={{ marginBottom: 6 }}>“{ride.comment}”</Sub> : null}
              <Button title={mainAction.title} onPress={() => act(mainAction.type, ride.id)} loading={busyId === ride.id} />
              <Row style={{ marginTop: 8 }}>
                <Button
                  kind="ghost"
                  title={t('drive.callRider')}
                  onPress={() => {
                    if (rider && rider.phone) Linking.openURL(`tel:${rider.phone}`);
                  }}
                  style={{ flex: 1, marginRight: inTrip ? 0 : 8 }}
                />
                {!inTrip ? (
                  <Button kind="ghost" title={t('common.cancel')} onPress={() => cancelRide(ride.id)} style={{ flex: 1 }} />
                ) : null}
              </Row>
            </Card>
          </FadeIn>
        );
      })}
    </View>
  );
}
