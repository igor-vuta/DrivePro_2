import { Platform } from 'react-native';
import { api } from './api';

// Push registration for both targets.
//
//   web    - service worker + PushManager, VAPID keys from the server
//   native - an Expo push token, which Expo relays to APNs / FCM
//
// Both end up in the same POST /api/push/subscribe; the server tells them
// apart by `kind`. Everything here is best-effort: a refused permission, a
// missing sw.js in dev, or Expo Go without an EAS project all return false
// rather than throwing.

function b64ToU8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// The native registration is a dynamic import so the web bundle never pulls
// expo-notifications in, and so a build without the module still runs.
async function setupNativePush(token, interactive) {
  try {
    const Notifications = await import('expo-notifications');
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted) {
      if (!interactive || existing.canAskAgain === false) return false;
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return false;

    // The token is scoped to the EAS project, which only exists once the app
    // has been built with `eas build`; in Expo Go this throws and we bail.
    const Constants = (await import('expo-constants')).default;
    const projectId =
      (Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.eas && Constants.expoConfig.extra.eas.projectId) ||
      (Constants.easConfig && Constants.easConfig.projectId);
    if (!projectId) return false;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!data) return false;
    await api('POST', '/api/push/subscribe', { subscription: { kind: 'expo', endpoint: data } }, token);
    return true;
  } catch (e) {
    return false;
  }
}

// interactive=true may show the permission prompt - call from a tap.
export async function setupPush(token, interactive = false) {
  if (Platform.OS !== 'web') return setupNativePush(token, interactive);
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
