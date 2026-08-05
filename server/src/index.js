import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { Hub } from './hub.js';
import { createApi } from './api.js';
import { acceptUpgrade } from './ws.js';
import { verifyToken } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PORT = Number(process.env.PORT || 4000);

// Persistent signing secret (created on first run).
fs.mkdirSync(DATA_DIR, { recursive: true });
const secretFile = path.join(DATA_DIR, '.secret');
if (!fs.existsSync(secretFile)) {
  fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
}
const secret = fs.readFileSync(secretFile, 'utf8').trim();

const store = new Store(DATA_DIR);
const hub = new Hub(store);
const api = createApi({ store, secret, hub });

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
  if (!user) {
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
});
