import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Server address resolution, in priority order:
//  1. MANUAL_SERVER - set this to point the app at a specific server:
//       - full URL for a hosted server, e.g. 'https://drivepro.up.railway.app'
//       - bare LAN IP for phone development, e.g. '192.168.1.23'
//  2. Hosted web: when the page is served by the DrivePro server itself,
//     API and websocket use the same origin (https -> wss automatically).
//  3. Development: the machine running Metro, port 4000.
const MANUAL_SERVER = null;
const DEV_PORT = 4000;

function fromBase(base) {
  const url = String(base).replace(/\/+$/, '');
  return {
    api: url,
    ws: `${url.replace(/^http/, 'ws')}/ws`,
    host: url.replace(/^https?:\/\//, ''),
  };
}

function detect() {
  if (MANUAL_SERVER) {
    const base = /^https?:\/\//.test(MANUAL_SERVER) ? MANUAL_SERVER : `http://${MANUAL_SERVER}:${DEV_PORT}`;
    return fromBase(base);
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    const { protocol, hostname, port, host } = window.location;
    const metroDevPorts = ['8081', '19000', '19006'];
    if (!metroDevPorts.includes(port)) {
      // Served by the DrivePro server (or any host in front of it).
      return fromBase(`${protocol}//${host}`);
    }
    return fromBase(`http://${hostname || 'localhost'}:${DEV_PORT}`);
  }
  const hostUri =
    (Constants.expoConfig && Constants.expoConfig.hostUri) ||
    (Constants.manifest2 &&
      Constants.manifest2.extra &&
      Constants.manifest2.extra.expoGo &&
      Constants.manifest2.extra.expoGo.debuggerHost) ||
    '';
  const devHost = String(hostUri).split(':')[0] || 'localhost';
  return fromBase(`http://${devHost}:${DEV_PORT}`);
}

const cfg = detect();
export const API_URL = cfg.api;
export const WS_URL = cfg.ws;
export const SERVER_HOST = cfg.host;
