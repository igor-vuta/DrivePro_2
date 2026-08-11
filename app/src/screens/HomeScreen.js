import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Screen, Button, Segmented, Row, FadeIn, Avatar, colors, SCREEN_PAD, SAFE_TOP } from '../ui';
import { RADIUS_LG, CHROME_TOP } from '../theme';
import { useAuth } from '../state';
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
        backgroundColor: colors.chrome,
        borderColor: colors.chromeBorder,
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
// It floats over the map now, so it is a compact pill rather than a full-width
// bar. The border blinks primary whenever fresh numbers arrive over the socket.
function CityStrip({ impact, connected }) {
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
  // The socket state used to have its own line under the wordmark; with the
  // chrome floating there is room for one pill, so it carries both - a dropped
  // connection is why the numbers would be stale in the first place.
  if (!impact && connected) return null;
  const border = pulse.interpolate({ inputRange: [0, 1], outputRange: [colors.chromeBorder, colors.primary] });
  return (
    <Animated.View
      style={{
        borderWidth: 1,
        borderColor: border,
        backgroundColor: colors.chrome,
        borderRadius: 999,
        paddingVertical: 6,
        paddingHorizontal: 11,
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
      }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: connected ? colors.ok : colors.gold, marginRight: 8 }} />
      {!connected ? (
        <Text style={{ color: colors.sub, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
          {t('home.reconnecting')}
        </Text>
      ) : (
        <>
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
        </>
      )}
    </Animated.View>
  );
}

export default function HomeScreen({ openProfile, openHistory, openSchedules, openCrew }) {
  const { me, wsConnected, activeRide, cityImpact } = useAuth();
  const [tab, setTab] = useState('ride');
  const [menu, setMenu] = useState(false);

  // A driver carrying passengers gets the convoy view; everyone else, and
  // every driver once the last passenger is out, belongs in the one flow the
  // app actually has. Without the second half of this, finishing a ride left
  // the driver parked in the convoy screen with nothing in it - the old
  // pre-L42 driver window, reachable only by having been a driver a minute
  // ago, and the only way back was to restart the app.
  useEffect(() => {
    setTab(activeRide && me && activeRide.driverId === me.id ? 'drive' : 'ride');
  }, [activeRide ? activeRide.id : null]);

  // The map is the app: it runs edge to edge and the chrome floats on top of
  // it, so switching modes lives in the avatar sheet rather than a tab bar.
  return (
    <Screen full>
      <View style={{ flex: 1 }}>
        {/* The chrome floats, so the space it needs - the notch plus the pills
            themselves - is reserved here and given back by <Bleed top> in the
            states that are a full-screen map. */}
        <View style={{ flex: 1, paddingTop: CHROME_TOP }}>
          <FadeIn keyId={tab} style={{ flex: 1 }}>
            {tab === 'ride' ? <RideTab /> : <DriveTab openProfile={openProfile} />}
          </FadeIn>
        </View>

        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: 0,
            left: -SCREEN_PAD,
            right: -SCREEN_PAD,
            paddingHorizontal: SCREEN_PAD,
            // The map runs under the status bar; these do not.
            paddingTop: SAFE_TOP,
          }}
        >
          {/* box-none has to be repeated here: react-native-web turns it into
              `pointer-events:none` on the element plus `& > * {auto}`, so a
              single full-width child would re-arm the whole strip and swallow
              map drags in the gaps between the pill and the avatar. */}
          <Row pointerEvents="box-none" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <CityStrip impact={cityImpact} connected={wsConnected} />
            <Row style={{ marginLeft: 8 }}>
              <FlamePill days={me ? me.streakDays : 0} />
              <Pressable onPress={() => setMenu(true)} hitSlop={8} accessibilityLabel={t('home.profile')}>
                <Avatar
                  user={me}
                  size={40}
                  style={{ borderWidth: 2, borderColor: colors.chrome, shadowColor: colors.shadow, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 }}
                />
              </Pressable>
            </Row>
          </Row>
        </View>
      </View>

      <MenuSheet
        visible={menu}
        onClose={() => setMenu(false)}
        openProfile={() => {
          setMenu(false);
          openProfile();
        }}
        openHistory={() => {
          setMenu(false);
          openHistory();
        }}
        openSchedules={() => {
          setMenu(false);
          openSchedules();
        }}
        openCrew={() => {
          setMenu(false);
          openCrew();
        }}
      />
      <WeeklyRecap />
    </Screen>
  );
}

// One tappable line in the avatar sheet.
function MenuRow({ icon, label, sub, onPress, danger }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 13,
        borderBottomWidth: 1,
        borderColor: colors.borderStrong,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ fontSize: 18, width: 30 }}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: danger ? colors.dangerInk : colors.text, fontWeight: '700', fontSize: 15 }}>{label}</Text>
        {sub ? <Text style={{ color: colors.sub, fontSize: 12, marginTop: 1 }}>{sub}</Text> : null}
      </View>
      <Text style={{ color: colors.sub, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}

// Everything that is not "get me somewhere" lives behind the avatar: which
// side of the ride you are on, your crew and history, the language, the way
// out. The map stays visible behind it.
function MenuSheet({ visible, onClose, openProfile, openHistory, openSchedules, openCrew }) {
  const { me, logout, langPref, setLanguage } = useAuth();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: colors.overlay }} />
      {/* The menu is its own region: sheet under it, a card for the identity
          header, so "who you are" and "where you can go" do not read as one
          undifferentiated list. */}
      <View
        style={{
          backgroundColor: colors.sheet,
          borderTopWidth: 1,
          borderColor: colors.border,
          borderTopLeftRadius: RADIUS_LG,
          borderTopRightRadius: RADIUS_LG,
          paddingHorizontal: SCREEN_PAD,
          paddingTop: 14,
          paddingBottom: 26,
          maxHeight: '85%',
        }}
      >
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: 14 }} />
        <ScrollView keyboardShouldPersistTaps="handled">
          <Pressable onPress={openProfile} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Row
              style={{
                marginBottom: 14,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: RADIUS_LG,
                padding: 12,
              }}
            >
              <Avatar user={me} size={52} style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }} numberOfLines={1}>
                  {me ? me.name : ''}
                </Text>
                <Text style={{ color: colors.sub, fontSize: 13 }}>
                  {me && me.rating != null ? `★ ${me.rating} (${me.ratingCount})` : t('common.noRatings')}
                </Text>
              </View>
            </Row>
          </Pressable>

          <MenuRow icon="👤" label={t('menu.profile')} onPress={openProfile} />
          <MenuRow icon="⏰" label={t('menu.schedules')} onPress={openSchedules} />
          <MenuRow icon="🏴" label={t('crew.title')} onPress={openCrew} />
          <MenuRow icon="🕘" label={t('menu.history')} onPress={openHistory} />

          <Text style={{ color: colors.text, fontWeight: '700', marginTop: 16, marginBottom: 8 }}>{t('profile.language')}</Text>
          <Segmented
            value={langPref}
            onChange={(v) => setLanguage(v)}
            options={[
              { value: 'auto', label: t('profile.langAuto') },
              { value: 'ru', label: 'РУ' },
              { value: 'kk', label: 'ҚАЗ' },
              { value: 'en', label: 'EN' },
            ]}
          />

          <Button kind="ghost" title={t('profile.logout')} onPress={logout} style={{ marginTop: 14 }} />
          <Button kind="ghost" title={t('menu.close')} onPress={onClose} style={{ height: 42 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}
