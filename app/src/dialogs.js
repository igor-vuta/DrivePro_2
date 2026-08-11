import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, Modal, Platform, Pressable, Text, View } from 'react-native';
import { colors } from './ui';

// In-app, non-blocking notifications and confirmations. Browser dialogs
// (window.alert / window.confirm) freeze rendering on web and behave
// erratically in modern browsers, so everything renders inside the app via
// DialogHost (mounted once at the root). Same call sites everywhere.

let hostApi = null;
let seq = 0;

export function notify(title, message) {
  if (hostApi) {
    hostApi.toast(title, message);
    return;
  }
  if (Platform.OS !== 'web') Alert.alert(title, message);
}

export function confirmAction(opts) {
  if (hostApi) {
    hostApi.confirm(opts);
    return;
  }
  if (Platform.OS !== 'web') {
    Alert.alert(opts.title, opts.message, [
      { text: opts.cancelLabel || 'Keep', style: 'cancel' },
      { text: opts.okLabel, style: opts.destructive === false ? 'default' : 'destructive', onPress: opts.onOk },
    ]);
  } else if (typeof window !== 'undefined' && window.confirm(`${opts.title}\n\n${opts.message}`)) {
    opts.onOk();
  }
}

export function DialogHost() {
  const [toasts, setToasts] = useState([]); // { id, title, message }
  const [confirm, setConfirm] = useState(null); // opts | null

  useEffect(() => {
    hostApi = {
      toast(title, message) {
        const id = ++seq;
        setToasts((t) => [...t.slice(-2), { id, title, message }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
      },
      confirm(opts) {
        setConfirm(opts);
      },
    };
    return () => {
      hostApi = null;
    };
  }, []);

  const dismiss = (id) => setToasts((t) => t.filter((x) => x.id !== id));

  const ToastItem = ({ x }) => {
    const v = useRef(new Animated.Value(0)).current;
    useEffect(() => {
      Animated.timing(v, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.back(1.4)),
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    }, []);
    return (
      <Animated.View
        style={{
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
        }}
      >
        <Pressable
          onPress={() => dismiss(x.id)}
          style={{
            backgroundColor: '#101728',
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 14,
            paddingVertical: 12,
            paddingHorizontal: 16,
            marginBottom: 8,
            shadowColor: colors.primary,
            shadowOpacity: 0.25,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>{x.title}</Text>
          {x.message ? <Text style={{ color: colors.sub, marginTop: 2 }}>{x.message}</Text> : null}
        </Pressable>
      </Animated.View>
    );
  };

  return (
    <>
      {toasts.length ? (
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', top: Platform.OS === 'web' ? 16 : 54, left: 16, right: 16, zIndex: 1000 }}
        >
          {toasts.map((x) => (
            <ToastItem key={x.id} x={x} />
          ))}
        </View>
      ) : null}

      {confirm ? (
        <Modal transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 28 }}>
            <View style={{ backgroundColor: colors.bg, borderRadius: 18, padding: 20 }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 18, marginBottom: 6 }}>{confirm.title}</Text>
              {confirm.message ? <Text style={{ color: colors.sub, marginBottom: 16 }}>{confirm.message}</Text> : null}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <Pressable onPress={() => setConfirm(null)} style={{ paddingVertical: 10, paddingHorizontal: 16 }}>
                  <Text style={{ color: colors.sub, fontWeight: '600' }}>{confirm.cancelLabel || 'Keep'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const ok = confirm.onOk;
                    setConfirm(null);
                    if (ok) ok();
                  }}
                  style={{ paddingVertical: 10, paddingHorizontal: 16 }}
                >
                  <Text style={{ color: confirm.destructive === false ? colors.primary : colors.danger, fontWeight: '700' }}>
                    {confirm.okLabel}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}
