import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { notify, confirmAction } from '../dialogs';
import * as Location from 'expo-location';
import MapView from '../MapView';
import { Card, Button, Sub, StatusDot, Row, Avatar, colors } from '../ui';
import { useAuth } from '../state';
import { api } from '../api';
import { wsClient } from '../ws';
import UserProfileModal from '../UserProfileModal';
import { t, errMsg } from '../i18n';

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
  const watchRef = useRef(null);
  const pendingAcceptRef = useRef(null);

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
      const sent = wsClient.send({ type: 'driver:activate', lat: latitude, lng: longitude });
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

      {driverActive ? (
        offers.length === 0 ? (
          <Card>
            <Sub style={{ marginBottom: 0 }}>{t('drive.waiting')}</Sub>
          </Card>
        ) : (
          <ScrollView>
            {[...offers].sort((a, b) => offerScore(b, nowTick) - offerScore(a, nowTick)).map((o) => (
              <Card key={o.ride.id}>
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
                        <Text style={{ color: '#b8860b', fontWeight: '700', fontSize: 13 }}>  ⚡{o.rider.points}</Text>
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
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 6 }}>{heading}</Text>
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
