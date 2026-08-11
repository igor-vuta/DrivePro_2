import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { Hub } from './hub.js';
import { createApi } from './api.js';
import { setupRides } from './rides.js';
import { setupSchedules } from './schedules.js';
import { acceptUpgrade } from './ws.js';
import { createStatic } from './static.js';
import { initPush } from './push.js';
import { verifyToken } from './auth.js';
import { otpModeBanner } from './otp.js';
import { smsBanner } from './sms.js';
import { initTelegram, telegramBanner } from './telegram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const WEB_DIR = process.env.WEB_DIR || path.join(__dirname, '..', '..', 'app', 'dist');
const PORT = Number(process.env.PORT || 4000);

// Persistent signing secret (created on first run).
fs.mkdirSync(DATA_DIR, { recursive: true });
const secretFile = path.join(DATA_DIR, '.secret');
if (!fs.existsSync(secretFile)) {
  fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
}
const secret = fs.readFileSync(secretFile, 'utf8').trim();

initPush(DATA_DIR);
const store = new Store(DATA_DIR);
const hub = new Hub(store);
setupRides({ store, hub });
setupSchedules({ store, hub });
const api = createApi({ store, secret, hub, serveStatic: createStatic(WEB_DIR) });
// Long-polls the Bot API in the background; a bot outage never blocks boot.
initTelegram({ store, dataDir: DATA_DIR }).catch(() => {});

const server = http.createServer((req, res) => {
  api(req, res).catch((e) => {
    console.error('unhandled request error:', e);
    try {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal error' }));
    } catch {}
  });
});

// WebSocket endpoint: ws://host:PORT/ws?token=<jwt>
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const payload = verifyToken(url.searchParams.get('token') || '', secret);
  const user = payload ? store.getUser(payload.uid) : null;
  // Same epoch rule as the HTTP side: a session evicted by a password reset
  // must not keep a live websocket either.
  if (!user || (payload.sep || 0) !== (user.tokenEpoch || 0)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const conn = acceptUpgrade(req, socket);
  if (!conn) return;
  hub.attach(conn, user);
  conn.feed(head);
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const lan = Object.values(nets)
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  console.log(`DrivePro server running (storage: ${store.backendName})`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  Network: http://${ip}:${PORT}  <- use this in the app on your phone`);
  console.log(
    fs.existsSync(path.join(WEB_DIR, 'index.html'))
      ? `  Web app: serving ${WEB_DIR}`
      : `  Web app: not built yet (cd app && npx expo export -p web)`
  );
  console.log(smsBanner());
  // May still be null here - initTelegram logs the outcome when getMe answers.
  const tg = telegramBanner();
  if (tg) console.log(tg);
  console.log(otpModeBanner());
});
