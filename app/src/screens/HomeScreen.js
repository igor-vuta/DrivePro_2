import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Screen, Button, Segmented, Row, FadeIn, Avatar, Chip, ListRow, TYPE, colors, SCREEN_PAD, SAFE_TOP } from '../ui';
import { RADIUS_LG, CHROME_TOP } from '../theme';
import { useAuth } from '../state';
import { t } from '../i18n';
import RideTab from './RideTab';
import DriveTab from './DriveTab';
import WeeklyRecap from '../WeeklyRecap';

// Mirrors server/src/streaks.js tiers - display only.
const flameMult = (days) => (days >= 30 ? 2 : days >= 14 ? 1.75 : days >= 7 ? 1.5 : days >= 3 ? 1.25 : 1);

// The daily flame: consecutive days with at least one shared ride. Gold is
// the points colour, so the streak is the solid gold chip rather than a
// chrome one with gold type in it - it is a reward and should look like one.
function FlamePill({ days }) {
  if (!days) return null;
  const mult = flameMult(days);
  return (
    <Chip tone="points" style={{ marginRight: 8 }}>
      {mult > 1 ? `🔥 ${days} ×${mult}` : `🔥 ${days}`}
    </Chip>
  );
}

// Live city impact: today's shared rides, km, and drivers at the wheel.
//
// It is the navy brand pill now - the design puts the city's own number on
// the brand surface, which is also what tells it apart from the gold streak
// beside it at a glance. The uppercase "CITY TODAY" label is gone with it:
// on one line over a map the number is the message, and the label was
// spending half the pill's width saying so.
//
// It still pulses when fresh numbers arrive over the socket, but as a nudge
// of scale rather than a colour change, because there is no border left to
// blink.
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
  // A dropped connection is why the numbers would be stale in the first
  // place, so the pill carries that too rather than earning a second one.
  if (!impact && connected) return null;
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });
  return (
    <Animated.View style={{ transform: [{ scale }], flexShrink: 1 }}>
      <Chip tone={connected ? 'brand' : 'default'} dot>
        {connected
          ? t('home.cityLine', { rides: impact.rides, km: impact.km, drivers: impact.driversOnline })
          : t('home.reconnecting')}
      </Chip>
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
            // The map runs under the status bar; these do not. The extra 8
            // keeps them off the very edge on a phone with no notch, where
            // SAFE_TOP resolves to 0 - still inside the band CHROME_TOP
            // reserves, so nothing below moves.
            paddingTop: SAFE_TOP,
            marginTop: 8,
          }}
        >
          {/* box-none has to be repeated here: react-native-web turns it into
              `pointer-events:none` on the element plus `& > * {auto}`, so a
              single full-width child would re-arm the whole strip and swallow
              map drags in the gaps between the pill and the avatar. */}
          <Row pointerEvents="box-none" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <CityStrip impact={cityImpact} connected={wsConnected} />
            <Row style={{ marginLeft: 8 }}>
              <FlamePill days={me ? me.streakDays : 0} />
              <Pressable onPress={() => setMenu(true)} hitSlop={8} accessibilityLabel={t('home.profile')}>
                <Avatar
                  user={me}
                  size={42}
                  tone="primary"
                  style={{ shadowColor: colors.shadow, shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5 }}
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
                <Text style={[TYPE.title, { color: colors.text }]} numberOfLines={1}>
                  {me ? me.name : ''}
                </Text>
                <Text style={[TYPE.meta, { color: colors.sub }]}>
                  {me && me.rating != null ? `★ ${me.rating} (${me.ratingCount})` : t('common.noRatings')}
                </Text>
              </View>
            </Row>
          </Pressable>

          <ListRow icon="👤" title={t('menu.profile')} trailing="›" onPress={openProfile} />
          <ListRow icon="⏰" title={t('menu.schedules')} trailing="›" onPress={openSchedules} />
          <ListRow icon="🏴" title={t('crew.title')} trailing="›" onPress={openCrew} />
          <ListRow icon="🕘" title={t('menu.history')} trailing="›" onPress={openHistory} />

          <Text style={[TYPE.overline, { color: colors.sub, marginTop: 18, marginBottom: 8 }]}>{t('profile.language')}</Text>
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
