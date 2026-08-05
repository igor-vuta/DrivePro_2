import React, { useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Screen, Title, Sub, Card, Button, Segmented, StatusDot, Row, colors } from '../ui';
import { useAuth } from '../state';
import { wsClient } from '../ws';
import { SERVER_HOST } from '../config';

export default function HomeScreen({ openProfile }) {
  const { me, wsConnected } = useAuth();
  const [tab, setTab] = useState('ride');

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <View>
          <Title style={{ marginBottom: 0 }}>DrivePro</Title>
          <StatusDot
            on={wsConnected}
            labelOn={`Connected (${SERVER_HOST})`}
            labelOff={`Connecting to ${SERVER_HOST}…`}
          />
        </View>
        <Button kind="ghost" title="Profile" onPress={openProfile} style={{ height: 40, paddingHorizontal: 14 }} />
      </Row>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'ride', label: 'Ride' },
          { value: 'drive', label: 'Drive' },
        ]}
      />

      {tab === 'ride' ? <RideTab /> : <DriveTab openProfile={openProfile} />}
    </Screen>
  );
}

function RideTab() {
  const { me } = useAuth();
  return (
    <View style={{ flex: 1 }}>
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 6 }}>
          Where to, {me ? me.name.split(' ')[0] : 'there'}?
        </Text>
        <Sub style={{ marginBottom: 0 }}>
          The map with pickup and destination pins arrives in the next milestone. This build covers accounts,
          profiles and driver activation.
        </Sub>
      </Card>
    </View>
  );
}

function DriveTab({ openProfile }) {
  const { me, driverActive, setDriverActive } = useAuth();
  const [busy, setBusy] = useState(false);
  const [coords, setCoords] = useState(null);
  const watchRef = useRef(null);

  // Stream location to the server while online.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (driverActive && !watchRef.current) {
        try {
          const sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 15 },
            (loc) => {
              const { latitude, longitude } = loc.coords;
              setCoords({ lat: latitude, lng: longitude });
              wsClient.send({ type: 'driver:location', lat: latitude, lng: longitude });
            }
          );
          if (cancelled) {
            sub.remove();
          } else {
            watchRef.current = sub;
          }
        } catch (e) {
          // Watch failing is not fatal; the activation position was already sent.
        }
      }
      if (!driverActive && watchRef.current) {
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
  }, [driverActive]);

  const goOnline = async () => {
    setBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Location needed', 'Allow location access so riders can find you.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;
      setCoords({ lat: latitude, lng: longitude });
      const sent = wsClient.send({ type: 'driver:activate', lat: latitude, lng: longitude });
      if (!sent) Alert.alert('Offline', 'Not connected to the server yet. Try again in a moment.');
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setBusy(false);
    }
  };

  const goOffline = () => {
    wsClient.send({ type: 'driver:deactivate' });
  };

  if (!me) return null;

  if (!me.isDriver) {
    return (
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 6 }}>
          Become a driver
        </Text>
        <Sub>Add your car details once, then go online whenever you want to take orders.</Sub>
        <Button title="Add car details" onPress={openProfile} />
      </Card>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Card>
        <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>
            {driverActive ? 'You are online' : 'You are offline'}
          </Text>
          <StatusDot on={driverActive} labelOn="Taking orders" labelOff="Not taking orders" />
        </Row>
        <Sub>
          {me.car ? `${me.car.color} ${me.car.make} ${me.car.model} · ${me.car.plate}` : ''}
        </Sub>
        {driverActive && coords ? (
          <Sub>Position: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</Sub>
        ) : null}
        {driverActive ? (
          <Button title="Go offline" onPress={goOffline} kind="ghost" />
        ) : (
          <Button title="Go online" onPress={goOnline} loading={busy} />
        )}
      </Card>
      {driverActive ? (
        <Card>
          <Sub style={{ marginBottom: 0 }}>
            Waiting for orders… Incoming order cards arrive in milestone 3.
          </Sub>
        </Card>
      ) : null}
    </View>
  );
}
