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

const NATIVE = Platform.OS !== 'web';
const WEB = Platform.OS === 'web';

// Horizontal padding every Screen applies; SCREEN_PAD is exported so full-
// bleed children can cancel it instead of repeating the magic number.
export const SCREEN_PAD = 16;

// Cyberpunk-luxury design system: deep night surfaces, neon cyan primaries,
// magenta trails, gold for points. Every screen inherits from these tokens.

export const colors = {
  bg: '#06070d',
  card: '#0e1220',
  text: '#e9f2ff',
  sub: '#8b96b8',
  primary: '#00e5ff',
  primaryText: '#02141a',
  accent: '#ff2bd6',
  gold: '#f5c518',
  border: '#1c2438',
  danger: '#ff3b5c',
  ok: '#00ffa3',
};

export function Screen({ children, style }) {
  return (
    <SafeAreaView style={[s.screen, style]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
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
export function Bleed({ children, style }) {
  return <View style={[{ flex: 1, marginHorizontal: -SCREEN_PAD }, style]}>{children}</View>;
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
      <TextInput placeholderTextColor="#4d5875" style={[s.input, style]} autoCapitalize="none" {...props} />
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

export function Row({ children, style }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

// Round profile picture with an initial-letter fallback and a neon ring.
export function Avatar({ user, size = 44, style }) {
  const initial = user && user.name ? user.name.trim().charAt(0).toUpperCase() : '?';
  const base = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: '#161c30',
    borderWidth: 1,
    borderColor: '#254a63',
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
      <Text style={{ fontSize: size * 0.42, fontWeight: '700', color: '#7ff3ff' }}>{initial}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenInner: {
    flex: 1,
    paddingHorizontal: SCREEN_PAD,
    paddingTop: 8,
    // On iOS native, SafeAreaView already handles the notch and the home
    // indicator. On web it is an ordinary View, so the insets have to come
    // from CSS - env() is a raw value react-native-web passes straight
    // through, and it resolves to 0px anywhere without a cutout.
    //
    // The root is position:fixed;inset:0, so in a standalone PWA it covers
    // the status bar too; without the top inset the first row would sit
    // under the clock. Vertical only: the horizontal padding is what Bleed
    // cancels with -SCREEN_PAD, and a dynamic value would stop matching.
    ...(WEB
      ? {
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }
      : {}),
  },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: 0.4, color: colors.text, marginBottom: 4 },
  titleGlow: {
    color: '#dffbff',
    textShadowColor: colors.primary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  sub: { fontSize: 14, color: colors.sub, marginBottom: 12 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  btn: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  btnPrimary: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  btnGhost: { backgroundColor: 'rgba(0,229,255,0.04)', borderWidth: 1, borderColor: '#254a63' },
  btnText: { fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  label: { fontSize: 13, color: colors.sub, marginBottom: 6 },
  input: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#223052',
    backgroundColor: '#0a0e1a',
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.text,
  },
  error: { color: colors.danger, marginBottom: 10, fontSize: 14 },
  seg: {
    flexDirection: 'row',
    backgroundColor: '#0a0e1a',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    marginBottom: 12,
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
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: 'rgba(10,14,26,0.86)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  segText: { fontSize: 15, color: colors.sub, fontWeight: '600' },
  segTextActive: { color: colors.primaryText, fontWeight: '800' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
});
