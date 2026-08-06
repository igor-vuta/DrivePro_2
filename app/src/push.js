import { Platform } from 'react-native';
import { api } from './api';

// Browser push subscription (web only). Native builds get real push later
// via EAS; in Expo Go / dev this quietly does nothing.

function b64ToU8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// interactive=true may show the browser permission prompt - call from a tap.
export async function setupPush(token, interactive = false) {
  if (Platform.OS !== 'web') return false;
  try {
    if (
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator) ||
      typeof window === 'undefined' ||
      !('PushManager' in window) ||
      typeof Notification === 'undefined'
    ) {
      return false;
    }
    if (Notification.permission === 'denied') return false;
    if (Notification.permission !== 'granted') {
      if (!interactive) return false;
      const p = await Notification.requestPermission();
      if (p !== 'granted') return false;
    }
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { key } = await api('GET', '/api/push/key', null, token);
      if (!key) return false;
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    }
    await api('POST', '/api/push/subscribe', { subscription: sub.toJSON() }, token);
    return true;
  } catch (e) {
    // no sw.js in dev mode, permissions refused, etc - all non-fatal
    return false;
  }
}
