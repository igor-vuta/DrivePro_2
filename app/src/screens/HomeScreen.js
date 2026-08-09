import React, { useEffect, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { Screen, Title, Button, Segmented, StatusDot, Row, FadeIn, colors } from '../ui';
import { useAuth } from '../state';
import { SERVER_HOST } from '../config';
import { t } from '../i18n';
import RideTab from './RideTab';
import DriveTab from './DriveTab';
import WeeklyRecap from '../WeeklyRecap';

// Mirrors server/src/streaks.js tiers - display only.
const flameMult = (days) => (days >= 30 ? 2 : days >= 14 ? 1.75 : days >= 7 ? 1.5 : days >= 3 ? 1.25 : 1);

// The daily flame: consecutive days with at least one shared ride.
function FlamePill({ days }) {
  if (!days) return null;
  const mult = flameMult(days);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1a1206',
        borderColor: '#3d2e0e',
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 10,
        height: 30,
        marginRight: 8,
      }}
    >
      <Text style={{ fontSize: 13 }}>🔥</Text>
      <Text style={{ color: colors.gold, fontWeight: '800', marginLeft: 4, fontSize: 13 }}>{days}</Text>
      {mult > 1 ? (
        <Text style={{ color: colors.sub, marginLeft: 6, fontSize: 11, fontWeight: '700' }}>×{mult}</Text>
      ) : null}
    </View>
  );
}

// Live city impact strip: today's shared rides + km and drivers at the wheel.
// The border blinks neon-cyan whenever fresh numbers arrive over the socket.
function CityStrip({ impact }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const first = useRef(true);
  const stamp = impact ? `${impact.rides}|${impact.km}|${impact.driversOnline}` : '';
  useEffect(() => {
    if (!impact) return;
    if (first.current) {
      first.current = false;
      return;
    }
    pulse.setValue(1);
    Animated.timing(pulse, { toValue: 0, duration: 1100, useNativeDriver: false }).start();
  }, [stamp]);
  if (!impact) return null;
  const border = pulse.interpolate({ inputRange: [0, 1], outputRange: [colors.border, colors.primary] });
  return (
    <Animated.View
      style={{
        borderWidth: 1,
        borderColor: border,
        backgroundColor: colors.card,
        borderRadius: 14,
        paddingVertical: 7,
        paddingHorizontal: 12,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ok, marginRight: 8 }} />
      <Text
        style={{
          color: colors.sub,
          fontSize: 11,
          fontWeight: '700',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginRight: 8,
        }}
      >
        {t('home.cityToday')}
      </Text>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>
        {t('home.cityLine', { rides: impact.rides, km: impact.km, drivers: impact.driversOnline })}
      </Text>
    </Animated.View>
  );
}

export default function HomeScreen({ openProfile }) {
  const { me, wsConnected, activeRide, cityImpact } = useAuth();
  const [tab, setTab] = useState('ride');

  // When a ride becomes active, jump to the tab where it lives.
  useEffect(() => {
    if (activeRide && me) {
      setTab(activeRide.driverId === me.id ? 'drive' : 'ride');
    }
  }, [activeRide ? activeRide.id : null]);

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <View>
          <Title glow style={{ marginBottom: 0, letterSpacing: 1.5 }}>DRIVEPRO</Title>
          <StatusDot
            on={wsConnected}
            labelOn={t('home.connected', { host: SERVER_HOST })}
            labelOff={t('home.connecting', { host: SERVER_HOST })}
          />
        </View>
        <Row>
          <FlamePill days={me ? me.streakDays : 0} />
          <Button kind="ghost" title={t('home.profile')} onPress={openProfile} style={{ height: 40, paddingHorizontal: 14 }} />
        </Row>
      </Row>

      <CityStrip impact={cityImpact} />

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'ride', label: t('home.ride') },
          { value: 'drive', label: t('home.drive') },
        ]}
      />

      <FadeIn keyId={tab} style={{ flex: 1 }}>
        {tab === 'ride' ? <RideTab /> : <DriveTab openProfile={openProfile} />}
      </FadeIn>
      <WeeklyRecap />
    </Screen>
  );
}
