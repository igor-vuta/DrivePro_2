import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

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

export function Title({ children, style, glow }) {
  return <Text style={[s.title, glow && s.titleGlow, style]}>{children}</Text>;
}

export function Sub({ children, style }) {
  return <Text style={[s.sub, style]}>{children}</Text>;
}

export function Card({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Button({ title, onPress, disabled, loading, kind = 'primary', style }) {
  const isPrimary = kind === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn,
        isPrimary ? s.btnPrimary : s.btnGhost,
        (disabled || loading) && { opacity: 0.4 },
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.primaryText : colors.primary} />
      ) : (
        <Text style={[s.btnText, isPrimary ? { color: colors.primaryText } : { color: colors.text }]}>{title}</Text>
      )}
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

export function StatusDot({ on, labelOn, labelOff }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View
        style={[
          s.dot,
          {
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
  screenInner: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
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
  segText: { fontSize: 15, color: colors.sub, fontWeight: '600' },
  segTextActive: { color: colors.primaryText, fontWeight: '800' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
});
