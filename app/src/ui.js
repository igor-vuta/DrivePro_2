import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, TYPE, FONT, SCREEN_PAD, CARD_PAD, GAP, INPUT_H, BUTTON_H, RADIUS, RADIUS_LG, CHROME_H, SAFE_TOP, SAFE_BOTTOM, CHROME_TOP_NEG } from './theme';

const NATIVE = Platform.OS !== 'web';

// Design system in Almaty's colours, light and dark - tokens live in
// theme.js. SCREEN_PAD is re-exported so full-bleed children can cancel the
// screen padding instead of repeating the number.
export { colors, TYPE, FONT, SCREEN_PAD, CHROME_H, SAFE_TOP, SAFE_BOTTOM };

// `full` is for the screen that is a map. It keeps the horizontal padding -
// panels still sit inset, and Bleed still cancels it - but stops reserving the
// notch and the home indicator at the top of the tree, so a full-bleed child
// can actually reach the edge of the display. Whatever must stay legible pads
// itself with SAFE_TOP / SAFE_BOTTOM instead.
export function Screen({ children, style, full }) {
  if (full) {
    return (
      <View style={[s.screen, style]}>
        <StatusBar barStyle={colors.statusBar} backgroundColor={colors.bg} />
        <View style={s.screenInnerFull}>{children}</View>
      </View>
    );
  }
  return (
    <SafeAreaView style={[s.screen, style]}>
      <StatusBar barStyle={colors.statusBar} backgroundColor={colors.bg} />
      <View style={s.screenInner}>{children}</View>
    </SafeAreaView>
  );
}

// Fade + slide-up on mount; re-runs when keyId changes (screen/tab/step switches).
export function FadeIn({ children, keyId, delay = 0, from = 14, style }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    v.setValue(0);
    Animated.timing(v, {
      toValue: 1,
      duration: 240,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    }).start();
  }, [keyId]);
  return (
    <Animated.View
      style={[
        { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }] },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

// Confirmation motion for the moments that change what the driver or rider is
// doing - going online, requesting, accepting, finishing. Scales up from 96%
// while fading in, so the new state announces itself without a jump.
export function Pop({ children, keyId, style }) {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    v.setValue(0);
    Animated.timing(v, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE,
    }).start();
  }, [keyId]);
  return (
    <Animated.View
      style={[
        { flex: 1, opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

// Two steps of heading. `display` is the sheet's headline - the size the
// design draws "Куда едем?" at - and `title` is one step under it, for a
// heading inside a card where 29px would shout.
export function Title({ children, style, glow, step = 'display' }) {
  return <Text style={[step === 'title' ? s.titleSm : s.title, glow && s.titleGlow, style]}>{children}</Text>;
}

// Three steps of secondary text, all in the muted ink:
//   sub       the line under a Title
//   meta      a detail line: "Аль-Фараби 77 · 22 мин"
//   overline  the small caps label above a block: "12 ВОДИТЕЛЕЙ РЯДОМ"
// `tone` recolours it without changing the step - an overline in `ok` is how
// the design labels anything live.
export function Sub({ children, style, step = 'sub', tone }) {
  const inkFor = { ok: colors.okInk, go: colors.dangerInk, gold: colors.gold, primary: colors.primaryInk };
  const stepStyle = step === 'meta' ? s.meta : step === 'overline' ? s.overline : s.sub;
  return <Text style={[stepStyle, tone && { color: inkFor[tone] }, style]}>{children}</Text>;
}

export function Card({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>;
}

// Cancels the Screen's horizontal padding so a child (the map) reaches both
// edges while the panels around it stay inset.
// `top` also cancels the space the home screen reserves for its floating
// chrome, so a full-screen map reaches the very top of the display.
export function Bleed({ children, style, top }) {
  return (
    <View style={[{ flex: 1, marginHorizontal: -SCREEN_PAD }, top ? { marginTop: CHROME_TOP_NEG } : null, style]}>
      {children}
    </View>
  );
}

// `primary` is the commit action - the button that starts a ride - and the
// design draws it in apple, not in the interactive blue. Blue stays for the
// things you *choose* (chips, segments, links); apple is the thing you *do*.
export function Button({ title, onPress, disabled, loading, kind = 'primary', style }) {
  const isPrimary = kind === 'primary';
  const scale = React.useRef(new Animated.Value(1)).current;
  const pump = (to) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: NATIVE, speed: 40, bounciness: 6 }).start();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      onPressIn={() => pump(0.93)}
      onPressOut={() => pump(1)}
      style={({ pressed }) => [
        s.btn,
        isPrimary ? s.btnPrimary : s.btnGhost,
        (disabled || loading) && { opacity: 0.4 },
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {loading ? (
          <ActivityIndicator color={isPrimary ? colors.onGo : colors.primary} />
        ) : (
          <Text style={[s.btnText, isPrimary ? { color: colors.onGo } : { color: colors.text }]}>{title}</Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

export function Input({ label, style, containerStyle, ...props }) {
  return (
    <View style={[{ marginBottom: 12 }, containerStyle]}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.sub} style={[s.input, style]} autoCapitalize="none" {...props} />
    </View>
  );
}

// Live phone mask: "+7 777 777 7777" as you type. Kazakh and Russian numbers
// are routinely written with the 8 trunk prefix, so a complete 8XXXXXXXXXX is
// rewritten to +7 - only at full length, where it is unambiguous. Numbers from
// anywhere else keep their digits with no invented grouping. The server's
// normPhone() strips separators again, so the display format is free.
export function formatPhone(raw) {
  const s = String(raw == null ? '' : raw);
  let d = s.replace(/\D/g, '');
  if (!d) return s.trimStart().startsWith('+') ? '+' : '';
  if (d[0] === '8' && d.length === 11) d = `7${d.slice(1)}`;
  if (d[0] !== '7') return `+${d.slice(0, 15)}`;
  const rest = d.slice(1, 11);
  const groups = [rest.slice(0, 3), rest.slice(3, 6), rest.slice(6, 10)].filter(Boolean);
  return `+7${groups.length ? ` ${groups.join(' ')}` : ''}`;
}

export function PhoneInput({ value, onChangeText, ...props }) {
  return (
    <Input
      value={value}
      onChangeText={(v) => onChangeText(formatPhone(v))}
      placeholder="+7 777 777 7777"
      keyboardType="phone-pad"
      autoComplete="tel"
      maxLength={20}
      {...props}
    />
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <Text style={s.error}>{String(children)}</Text>;
}

export function Segmented({ options, value, onChange }) {
  return (
    <View style={s.seg}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <Pressable key={opt.value} onPress={() => onChange(opt.value)} style={[s.segItem, active && s.segItemActive]}>
            <Text style={[s.segText, active && s.segTextActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Compact pill for controls that float over a full-screen map. It is chrome,
// not a panel, so it takes the blue-cast chrome tokens rather than card.
export function Chip({ children, onPress, tone = 'default', style }) {
  const tint =
    tone === 'active'
      ? colors.onTint
      : tone === 'danger'
      ? colors.dangerInk
      : tone === 'gold'
      ? colors.gold
      : colors.text;
  const body = (
    <View style={[s.chip, tone === 'active' && { borderColor: colors.primary, backgroundColor: colors.tint }, style]}>
      {typeof children === 'string' ? (
        <Text style={[TYPE.chip, { color: tint }]}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)} hitSlop={6}>
      {body}
    </Pressable>
  );
}

export function StatusDot({ on, labelOn, labelOff }) {
  const pulse = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    if (!on) {
      pulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [on]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Animated.View
        style={[
          s.dot,
          {
            opacity: pulse,
            backgroundColor: on ? colors.ok : colors.danger,
            shadowColor: on ? colors.ok : colors.danger,
            shadowOpacity: 0.9,
            shadowRadius: 5,
            shadowOffset: { width: 0, height: 0 },
          },
        ]}
      />
      <Text style={{ color: colors.sub, fontSize: 12 }}>{on ? labelOn : labelOff}</Text>
    </View>
  );
}

// A small label pinned over the map: an ETA beside a car, the name of the
// place you are heading for, "Вы здесь" beside your own dot.
//
// It is NOT a Chip. A Chip is a 36px control with a 999px radius that you tap;
// a MapPill is a 26px label with a soft 9px radius that mostly you do not.
// They read differently on purpose - furniture you operate versus annotation
// on the map itself.
export function MapPill({ children, tone = 'brand', dot, onPress, style }) {
  const skin = {
    brand: { bg: colors.brand, ink: colors.onBrand },
    ok: { bg: colors.ok, ink: colors.onGo },
    go: { bg: colors.go, ink: colors.onGo },
    plain: { bg: colors.card, ink: colors.text },
  }[tone] || { bg: colors.brand, ink: colors.onBrand };
  const body = (
    <View style={[s.mapPill, { backgroundColor: skin.bg }, style]}>
      {dot ? <View style={[s.mapPillDot, { backgroundColor: tone === 'plain' ? colors.ok : skin.ink }]} /> : null}
      {typeof children === 'string' ? (
        <Text style={[TYPE.meta, { color: skin.ink, fontWeight: '800' }]}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.75 } : null)} hitSlop={8}>
      {body}
    </Pressable>
  );
}

// One line of a list: something on the left, a name, a detail line under it,
// and something on the right. It is the workhorse of the sheet - saved places,
// route endpoints, ride history all draw as this.
//
// `icon` takes either a node or a string; a string is drawn as a letter in a
// rounded tile, which is how the design renders Дом and Работа. `iconTone`
// colours that tile. For a route endpoint pass `dot` instead: a bare coloured
// dot, no tile.
export function ListRow({ title, meta, icon, iconTone = 'primary', dot, trailing, selected, onPress, style }) {
  const tileSkin = {
    primary: { bg: colors.tint, ink: colors.onTint },
    go: { bg: colors.go, ink: colors.onGo },
    ok: { bg: colors.ok, ink: colors.onGo },
    brand: { bg: colors.brand, ink: colors.onBrand },
  }[iconTone] || { bg: colors.tint, ink: colors.onTint };
  const body = (
    <View style={[s.listRow, selected && s.listRowSelected, style]}>
      {dot ? <View style={[s.listDot, { backgroundColor: dot === true ? colors.ok : dot }]} /> : null}
      {icon != null && !dot ? (
        typeof icon === 'string' ? (
          <View style={[s.listTile, { backgroundColor: tileSkin.bg }]}>
            <Text style={[TYPE.row, { color: tileSkin.ink }]}>{icon}</Text>
          </View>
        ) : (
          <View style={s.listLeading}>{icon}</View>
        )
      ) : null}
      <View style={s.listBody}>
        <Text style={s.listTitle} numberOfLines={1}>
          {title}
        </Text>
        {meta ? (
          <Text style={s.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {typeof trailing === 'string' ? <Text style={s.listTrailing}>{trailing}</Text> : trailing}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
      {body}
    </Pressable>
  );
}

// A ListRow in selection mode. The design draws the chosen destination as a
// tinted row with a check where the chevron was, so this is that row rather
// than a separate component: same metrics, same leading, different trailing.
export function SelectRow({ selected, onSelect, ...props }) {
  return (
    <ListRow
      {...props}
      selected={selected}
      onPress={onSelect}
      trailing={
        selected ? (
          <Text style={[TYPE.row, { color: colors.primaryInk }]}>✓</Text>
        ) : (
          <Text style={[TYPE.row, { color: colors.borderStrong }]}>›</Text>
        )
      }
    />
  );
}

// The bottom dock over the map, with snap points.
//
// Three stops, as fractions of the space the sheet is given:
//   peek  just the handle and the headline - the map has the screen
//   half  the working state: search, saved places, the action
//   full  a list you are reading rather than glancing at
//
// It can be driven (`snap="full"`) or dragged; `onSnapChange` fires with the
// stop the drag landed on, so a screen can keep its own state in step. The
// drag lives on the handle and the header only - the body scrolls normally,
// which is why a ScrollView inside it does not fight the gesture.
//
// `header` renders on the navy brand surface and the body on white beneath
// it, which is the split the design uses: the question on the brand, the
// answer on the paper.
export const SHEET_SNAPS = { peek: 0.2, half: 0.5, full: 0.9 };

export function Sheet({ children, header, snap = 'half', onSnapChange, snaps = SHEET_SNAPS, style }) {
  const [boxH, setBoxH] = React.useState(0);
  const at = (name) => Math.round((snaps[name] ?? snaps.half) * boxH);
  const h = React.useRef(new Animated.Value(0)).current;
  const from = React.useRef(0);
  const settled = React.useRef(snap);

  // Follow the prop, and take the first real measurement without animating -
  // an opening sheet should already be where it belongs on the first frame.
  React.useEffect(() => {
    if (!boxH) return;
    const to = at(snap);
    settled.current = snap;
    if (!from.current) {
      from.current = to;
      h.setValue(to);
      return;
    }
    from.current = to;
    Animated.spring(h, { toValue: to, useNativeDriver: false, speed: 14, bounciness: 4 }).start();
  }, [snap, boxH]);

  const pan = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
        onPanResponderMove: (_e, g) => {
          const next = Math.min(at('full'), Math.max(at('peek'), from.current - g.dy));
          h.setValue(next);
        },
        onPanResponderRelease: (_e, g) => {
          // Velocity first: a flick is an instruction, not a measurement, so a
          // fast drag skips to the next stop even if it barely moved.
          const landed = from.current - g.dy;
          const order = ['peek', 'half', 'full'];
          let name;
          if (Math.abs(g.vy) > 0.7) {
            const i = order.indexOf(settled.current);
            name = order[Math.min(order.length - 1, Math.max(0, i + (g.vy < 0 ? 1 : -1)))];
          } else {
            name = order.reduce((best, n) => (Math.abs(at(n) - landed) < Math.abs(at(best) - landed) ? n : best), order[0]);
          }
          const to = at(name);
          from.current = to;
          Animated.spring(h, { toValue: to, useNativeDriver: false, speed: 14, bounciness: 4 }).start();
          if (name !== settled.current) {
            settled.current = name;
            if (onSnapChange) onSnapChange(name);
          }
        },
      }),
    [boxH, onSnapChange]
  );

  return (
    <View style={s.sheetBox} pointerEvents="box-none" onLayout={(e) => setBoxH(e.nativeEvent.layout.height)}>
      <Animated.View style={[s.sheet, boxH ? { height: h } : { height: 0 }, style]}>
        <View {...pan.panHandlers}>
          <View style={s.sheetGrip}>
            <View style={s.sheetGripBar} />
          </View>
          {header ? <View style={s.sheetHeader}>{header}</View> : null}
        </View>
        <View style={s.sheetBody}>{children}</View>
      </Animated.View>
    </View>
  );
}

export function Row({ children, style, ...rest }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]} {...rest}>
      {children}
    </View>
  );
}

// Round profile picture with an initial-letter fallback and a neon ring.
export function Avatar({ user, size = 44, style }) {
  const initial = user && user.name ? user.name.trim().charAt(0).toUpperCase() : '?';
  const base = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  };
  if (user && user.avatar) {
    return (
      <View style={[base, style]}>
        <Image source={{ uri: user.avatar }} style={{ width: size, height: size }} />
      </View>
    );
  }
  return (
    <View style={[base, style]}>
      <Text style={{ fontSize: size * 0.42, fontWeight: '700', color: colors.primaryInk }}>{initial}</Text>
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  // No safe-area padding here: SafeAreaView (the Screen wrapper) already
  // applies env(safe-area-inset-*) on all four sides in react-native-web.
  // Adding it again doubled the notch and home-indicator gaps on iOS, which
  // is what the "strange margins top and bottom" turned out to be.
  screenInner: { flex: 1, paddingHorizontal: SCREEN_PAD, paddingTop: 10 },
  // No top padding and no safe-area inset: the map starts at pixel zero.
  screenInnerFull: { flex: 1, paddingHorizontal: SCREEN_PAD },
  // The screen headline is the ramp's `display` step - "Куда едем?" is the
  // size the design draws it at.
  title: { ...TYPE.display, color: colors.text, marginBottom: 6 },
  titleSm: { ...TYPE.title, color: colors.text, marginBottom: 6 },
  meta: { ...TYPE.meta, color: colors.sub },
  overline: { ...TYPE.overline, color: colors.sub, marginBottom: 6 },
  // A map pill is annotation, not furniture: small radius, tight padding, and
  // a shadow strong enough to hold it off a busy map.
  mapPill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 26,
    paddingHorizontal: 9,
    borderRadius: 9,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  mapPillDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, marginHorizontal: -10, borderRadius: 14 },
  listRowSelected: { backgroundColor: colors.tint },
  listTile: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 13 },
  listLeading: { marginRight: 13 },
  listDot: { width: 9, height: 9, borderRadius: 5, marginRight: 13, marginLeft: 4 },
  listBody: { flex: 1 },
  listTitle: { ...TYPE.row, color: colors.text },
  listTrailing: { ...TYPE.meta, color: colors.sub, marginLeft: 10 },
  // The sheet measures the space it is given, then draws itself at the bottom
  // of it; box-none on the wrapper so the map above stays tappable.
  sheetBox: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.sheet,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -10 },
    elevation: 12,
  },
  sheetGrip: { alignItems: 'center', paddingTop: 11, paddingBottom: 7, backgroundColor: colors.brand },
  sheetGripBar: { width: 40, height: 4, borderRadius: 99, backgroundColor: colors.brandSub },
  sheetHeader: { backgroundColor: colors.brand, paddingHorizontal: 20, paddingBottom: 26 },
  sheetBody: { flex: 1, backgroundColor: colors.sheet, paddingHorizontal: 20, paddingTop: 14 },
  // Glow only exists in dark; in light the token is transparent, so the
  // wordmark simply renders solid.
  titleGlow: {
    color: colors.primary,
    textShadowColor: colors.glow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  sub: { ...TYPE.sub, color: colors.sub, marginBottom: 12 },
  card: {
    backgroundColor: colors.card,
    borderRadius: RADIUS_LG,
    padding: CARD_PAD,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: GAP,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  btn: {
    height: BUTTON_H,
    borderRadius: RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  btnPrimary: {
    backgroundColor: colors.go,
    // Glow in dark, a soft drop shadow in light - see theme.js.
    shadowColor: colors.glow === 'transparent' ? colors.shadow : colors.go,
    shadowOpacity: 1,
    shadowRadius: colors.glow === 'transparent' ? 6 : 14,
    shadowOffset: { width: 0, height: colors.glow === 'transparent' ? 2 : 0 },
    elevation: 4,
  },
  // A ghost button is only its outline, so it takes the hairline that is meant
  // to be seen; colors.border would vanish on card and on sheet alike.
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.borderStrong },
  btnText: { ...TYPE.button },
  label: { ...TYPE.meta, color: colors.sub, marginBottom: 8 },
  input: {
    height: INPUT_H,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    ...TYPE.body,
    color: colors.text,
  },
  error: { ...TYPE.sub, color: colors.dangerInk, marginBottom: 12 },
  seg: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    marginBottom: GAP,
  },
  segItem: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segItemActive: {
    backgroundColor: colors.primary,
    shadowColor: colors.glow === 'transparent' ? colors.shadow : colors.primary,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: colors.glow === 'transparent' ? 1 : 0 },
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: colors.chrome,
    borderWidth: 1,
    borderColor: colors.chromeBorder,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  segText: { ...TYPE.row, fontWeight: '700', color: colors.sub },
  segTextActive: { color: colors.primaryText, fontWeight: '800' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  });

// Rebuilt whenever the scheme flips; the root re-renders, so every component
// picks the new sheet up on its next render.
let s = makeStyles();
export function refreshStyles() {
  s = makeStyles();
}
