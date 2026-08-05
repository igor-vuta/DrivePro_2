import { readJson, sendJson, httpError, normPhone, cleanStr } from './util.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js';
import { publicUser } from './hub.js';

// REST API. Routes are matched as `${METHOD} ${pattern}`; `:param` segments
// are captured into params.

export function createApi({ store, secret, hub }) {
  const routes = [];

  const route = (method, pattern, handler) => {
    const keys = [];
    const regex = new RegExp(
      '^' +
        pattern
          .split('/')
          .map((seg) => {
            if (seg.startsWith(':')) {
              keys.push(seg.slice(1));
              return '([^/]+)';
            }
            return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('/') +
        '$'
    );
    routes.push({ method, regex, keys, handler });
  };

  const authUser = (req) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token ? verifyToken(token, secret) : null;
    const user = payload ? store.getUser(payload.uid) : null;
    if (!user) throw httpError(401, 'authentication required');
    return user;
  };

  const sessionPayload = (user) => ({
    token: signToken({ uid: user.id }, secret),
    user: publicUser(store, user.id),
  });

  // ----------------------------------------------------------- routes ---

  route('GET', '/api/health', async (req, res) => {
    sendJson(res, 200, { ok: true, name: 'DrivePro', storage: store.backendName, time: Date.now() });
  });

  route('POST', '/api/register', async (req, res) => {
    const body = await readJson(req);
    const phone = normPhone(body.phone);
    const name = cleanStr(body.name, 60);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!phone) throw httpError(400, 'Enter a valid phone number.');
    if (name.length < 2) throw httpError(400, 'Enter your name.');
    if (password.length < 4) throw httpError(400, 'Password must be at least 4 characters.');
    if (store.findUserByPhone(phone)) throw httpError(409, 'This phone number is already registered.');
    const user = store.createUser({ phone, passwordHash: hashPassword(password), name });
    sendJson(res, 201, sessionPayload(user));
  });

  route('POST', '/api/login', async (req, res) => {
    const body = await readJson(req);
    const phone = normPhone(body.phone);
    const password = typeof body.password === 'string' ? body.password : '';
    const user = phone ? store.findUserByPhone(phone) : null;
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw httpError(401, 'Wrong phone number or password.');
    }
    sendJson(res, 200, sessionPayload(user));
  });

  route('GET', '/api/me', async (req, res) => {
    const user = authUser(req);
    sendJson(res, 200, {
      user: publicUser(store, user.id),
      driverActive: hub ? hub.drivers.has(user.id) : false,
      activeRide: store.findActiveRideForUser(user.id),
    });
  });

  route('PUT', '/api/me', async (req, res) => {
    const user = authUser(req);
    const body = await readJson(req);
    const name = cleanStr(body.name, 60);
    if (name.length < 2) throw httpError(400, 'Enter your name.');
    store.updateUserName(user.id, name);
    sendJson(res, 200, { user: publicUser(store, user.id) });
  });

  route('PUT', '/api/me/driver', async (req, res) => {
    const user = authUser(req);
    const body = await readJson(req);
    const carMake = cleanStr(body.carMake, 40);
    const carModel = cleanStr(body.carModel, 40);
    const carColor = cleanStr(body.carColor, 30);
    const plate = cleanStr(body.plate, 16).toUpperCase();
    if (!carMake || !carModel || !carColor || !plate) {
      throw httpError(400, 'Car make, model, color and plate are all required.');
    }
    store.upsertDriverProfile(user.id, { carMake, carModel, carColor, plate });
    sendJson(res, 200, { user: publicUser(store, user.id) });
  });

  route('GET', '/api/users/:id', async (req, res, params) => {
    authUser(req);
    const profile = publicUser(store, params.id);
    if (!profile) throw httpError(404, 'user not found');
    // Phone numbers are only revealed to ride counterparts (later milestone
    // exposes them inside ride payloads); keep the public profile clean.
    const { phone, ...rest } = profile;
    sendJson(res, 200, { user: rest });
  });

  route('GET', '/api/rides', async (req, res) => {
    const user = authUser(req);
    sendJson(res, 200, { rides: store.listRidesForUser(user.id, 50) });
  });

  // --------------------------------------------------------- dispatch ---

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      });
      res.end();
      return;
    }

    if (path === '/' && req.method === 'GET') {
      sendJson(res, 200, { name: 'DrivePro server', ok: true });
      return;
    }

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.regex.exec(path);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      try {
        await r.handler(req, res, params, url);
      } catch (e) {
        const status = e.status || 500;
        if (status === 500) console.error('API error:', e);
        sendJson(res, status, { error: e.message || 'internal error' });
      }
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  };
}
