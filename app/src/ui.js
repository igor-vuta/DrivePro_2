import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, SCREEN_PAD, CARD_PAD, GAP, INPUT_H, BUTTON_H, RADIUS, RADIUS_LG, CHROME_H } from './theme';

const NATIVE = Platform.OS !== 'web';

// Design system in Almaty's colours, light and dark - tokens live in
// theme.js. SCREEN_PAD is re-exported so full-bleed children can cancel the
// screen padding instead of repeating the number.
export { colors, SCREEN_PAD, CHROME_H };

export function Screen({ children, style }) {
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

export function Title({ children, style, glow }) {
  return <Text style={[s.title, glow && s.titleGlow, style]}>{children}</Text>;
}

export function Sub({ children, style }) {
  return <Text style={[s.sub, style]}>{children}</Text>;
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
    <View style={[{ flex: 1, marginHorizontal: -SCREEN_PAD }, top ? { marginTop: -CHROME_H } : null, style]}>
      {children}
    </View>
  );
}

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
          <ActivityIndicator color={isPrimary ? colors.primaryText : colors.primary} />
        ) : (
          <Text style={[s.btnText, isPrimary ? { color: colors.primaryText } : { color: colors.text }]}>{title}</Text>
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

// Compact translucent pill for controls that float over a full-screen map.
export function Chip({ children, onPress, tone = 'default', style }) {
  const tint =
    tone === 'active' ? colors.primary : tone === 'danger' ? colors.danger : tone === 'gold' ? colors.gold : colors.text;
  const body = (
    <View style={[s.chip, tone === 'active' && { borderColor: colors.primary }, style]}>
      {typeof children === 'string' ? (
        <Text style={{ color: tint, fontWeight: '700', fontSize: 13 }}>{children}</Text>
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
      <Text style={{ fontSize: size * 0.42, fontWeight: '700', color: colors.primary }}>{initial}</Text>
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
  title: { fontSize: 26, fontWeight: '800', letterSpacing: 0.4, color: colors.text, marginBottom: 6 },
  // Glow only exists in dark; in light the token is transparent, so the
  // wordmark simply renders solid.
  titleGlow: {
    color: colors.primary,
    textShadowColor: colors.glow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  sub: { fontSize: 14, lineHeight: 20, color: colors.sub, marginBottom: 12 },
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
    backgroundColor: colors.primary,
    // Glow in dark, a soft drop shadow in light - see theme.js.
    shadowColor: colors.glow === 'transparent' ? colors.shadow : colors.primary,
    shadowOpacity: 1,
    shadowRadius: colors.glow === 'transparent' ? 6 : 14,
    shadowOffset: { width: 0, height: colors.glow === 'transparent' ? 2 : 0 },
    elevation: 4,
  },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  btnText: { fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  label: { fontSize: 13, color: colors.sub, marginBottom: 8 },
  input: {
    height: INPUT_H,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    fontSize: 16,
    color: colors.text,
  },
  error: { color: colors.danger, marginBottom: 12, fontSize: 14, lineHeight: 20 },
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
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  segText: { fontSize: 15, color: colors.sub, fontWeight: '600' },
  segTextActive: { color: colors.primaryText, fontWeight: '800' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  });

// Rebuilt whenever the scheme flips; the root re-renders, so every component
// picks the new sheet up on its next render.
let s = makeStyles();
export function refreshStyles() {
  s = makeStyles();
}
