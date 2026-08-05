import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

// Bare-bones UI kit. Visual design is intentionally minimal for now;
// styling gets its own pass in a later milestone.

export const colors = {
  bg: '#f7f7f7',
  card: '#ffffff',
  text: '#111111',
  sub: '#6b6b6b',
  primary: '#111111',
  primaryText: '#ffffff',
  border: '#e3e3e3',
  danger: '#c62828',
  ok: '#2e7d32',
};

export function Screen({ children, style }) {
  return (
    <SafeAreaView style={[s.screen, style]}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <View style={s.screenInner}>{children}</View>
    </SafeAreaView>
  );
}

export function Title({ children, style }) {
  return <Text style={[s.title, style]}>{children}</Text>;
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
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.primaryText : colors.text} />
      ) : (
        <Text style={[s.btnText, isPrimary ? { color: colors.primaryText } : { color: colors.text }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Input({ label, style, ...props }) {
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor="#9a9a9a"
        style={[s.input, style]}
        autoCapitalize="none"
        {...props}
      />
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
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[s.segItem, active && s.segItemActive]}
          >
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
      <View style={[s.dot, { backgroundColor: on ? colors.ok : colors.danger }]} />
      <Text style={{ color: colors.sub, fontSize: 12 }}>{on ? labelOn : labelOff}</Text>
    </View>
  );
}

export function Row({ children, style }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenInner: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: 4 },
  sub: { fontSize: 14, color: colors.sub, marginBottom: 12 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  btn: {
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  btnText: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 13, color: colors.sub, marginBottom: 6 },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.text,
  },
  error: { color: colors.danger, marginBottom: 10, fontSize: 14 },
  seg: {
    flexDirection: 'row',
    backgroundColor: '#ececec',
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
  },
  segItem: {
    flex: 1,
    height: 40,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segItemActive: { backgroundColor: colors.card },
  segText: { fontSize: 15, color: colors.sub, fontWeight: '500' },
  segTextActive: { color: colors.text, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
});
