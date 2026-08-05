import { Platform } from 'react-native';
import Constants from 'expo-constants';

// The server runs on the same computer that runs `expo start`, so by default
// we point the app at the Metro host machine. If auto-detection fails on your
// network, set MANUAL_SERVER_HOST to your computer's LAN IP, e.g. '192.168.1.23'.
const MANUAL_SERVER_HOST = null;
const SERVER_PORT = 4000;

function detectHost() {
  if (MANUAL_SERVER_HOST) return MANUAL_SERVER_HOST;
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    return window.location.hostname || 'localhost';
  }
  const hostUri =
    (Constants.expoConfig && Constants.expoConfig.hostUri) ||
    (Constants.manifest2 &&
      Constants.manifest2.extra &&
      Constants.manifest2.extra.expoGo &&
      Constants.manifest2.extra.expoGo.debuggerHost) ||
    '';
  const host = String(hostUri).split(':')[0];
  return host || 'localhost';
}

export const SERVER_HOST = detectHost();
export const API_URL = `http://${SERVER_HOST}:${SERVER_PORT}`;
export const WS_URL = `ws://${SERVER_HOST}:${SERVER_PORT}/ws`;
