// End-to-end smoke test for the stage-1 server surface.
// Usage: start the server (PORT=4000), then `npm run smoke`.

const BASE = process.env.BASE || 'http://localhost:4000';
const WS_BASE = BASE.replace(/^http/, 'ws');

let passed = 0;
let failed = 0;

function check(label, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label} ${extra}`);
  }
}

async function api(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

function connectWs(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws?token=${encodeURIComponent(token)}`);
    const queue = [];
    const waiters = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'city:impact') return; // ambient live-counter broadcast (L12), not a reply
      const w = waiters.shift();
      if (w) w(msg);
      else queue.push(msg);
    };
    ws.onopen = () =>
      resolve({
        ws,
        next(timeoutMs = 4000) {
          return new Promise((res2, rej2) => {
            if (queue.length) return res2(queue.shift());
            const t = setTimeout(() => rej2(new Error('ws message timeout')), timeoutMs);
            waiters.push((m) => {
              clearTimeout(t);
              res2(m);
            });
          });
        },
        send(obj) {
          ws.send(JSON.stringify(obj));
        },
      });
    ws.onerror = (e) => reject(new Error('ws connect failed'));
  });
}

const suffix = String(Date.now()).slice(-7);
const riderPhone = `+44700${suffix}`;
const driverPhone = `+44701${suffix}`;

// --- health
{
  const r = await api('GET', '/api/health');
  check('health endpoint', r.status === 200 && r.json.ok === true, JSON.stringify(r.json));
  console.log(`      storage backend: ${r.json.storage}`);
}

// --- register rider + driver (phone verification flow)
let rider, driver;
{
  const r = await api('POST', '/api/register', { phone: riderPhone, password: 'test1234', name: 'Rita Rider' });
  check('register asks for verification', r.status === 201 && r.json.needsVerification && r.json.devCode, JSON.stringify(r.json));

  const v = await api('POST', '/api/verify', { phone: riderPhone, code: r.json.devCode });
  check('verify issues session', v.status === 200 && v.json.token && v.json.user.name === 'Rita Rider', JSON.stringify(v.json));
  rider = v.json;

  const dup = await api('POST', '/api/register', { phone: riderPhone, password: 'x12345', name: 'Dup' });
  check('duplicate phone rejected', dup.status === 409);

  const bad = await api('POST', '/api/register', { phone: '12', password: 'test1234', name: 'X Y' });
  check('bad phone rejected', bad.status === 400);

  const shortPw = await api('POST', '/api/register', { phone: '+15559990000', password: 'abc', name: 'Shorty' });
  check('short password rejected', shortPw.status === 400 && shortPw.json.code === 'password_short');

  const d = await api('POST', '/api/register', { phone: driverPhone, password: 'test1234', name: 'Dave Driver' });
  const dv = await api('POST', '/api/verify', { phone: driverPhone, code: d.json.devCode });
  check('register driver', dv.status === 200 && dv.json.token, JSON.stringify(dv.json));
  driver = dv.json;
}

// --- login
{
  const wrong = await api('POST', '/api/login', { phone: riderPhone, password: 'nope' });
  check('wrong password rejected', wrong.status === 401);

  const r = await api('POST', '/api/login', { phone: `  +44 700 ${suffix} `, password: 'test1234' });
  check('login with messy phone formatting', r.status === 200 && r.json.user.id === rider.user.id, JSON.stringify(r.json));
}

// --- me / profile
{
  const me = await api('GET', '/api/me', null, rider.token);
  check('GET /api/me', me.status === 200 && me.json.user.id === rider.user.id && me.json.activeRide === null);

  const upd = await api('PUT', '/api/me', { name: 'Rita R.' }, rider.token);
  check('rename profile', upd.status === 200 && upd.json.user.name === 'Rita R.');

  const noauth = await api('GET', '/api/me');
  check('me without token rejected', noauth.status === 401);
}

// --- driver profile
{
  const bad = await api('PUT', '/api/me/driver', { carMake: 'VW' }, driver.token);
  check('incomplete car details rejected', bad.status === 400);

  const ok = await api('PUT', '/api/me/driver', { carMake: 'VW', carModel: 'Golf', carColor: 'Black', plate: 'ab12 cde' }, driver.token);
  check('driver profile saved', ok.status === 200 && ok.json.user.isDriver && ok.json.user.car.plate === 'AB12 CDE', JSON.stringify(ok.json));
}

// --- public profile
{
  const p = await api('GET', `/api/users/${driver.user.id}`, null, rider.token);
  check('public profile visible', p.status === 200 && p.json.user.name === 'Dave Driver' && p.json.user.car);
  check('public profile hides phone', p.json.user.phone === undefined);
}

// --- websocket: bad token rejected
{
  let rejected = false;
  try {
    await connectWs('garbage-token');
  } catch {
    rejected = true;
  }
  check('ws rejects bad token', rejected);
}

// --- websocket: rider + driver sessions
{
  const dws = await connectWs(driver.token);
  const hello = await dws.next();
  check('ws hello for driver', hello.type === 'hello' && hello.user.id === driver.user.id && hello.driverActive === false);

  dws.send({ type: 'ping', reqId: 'p1' });
  const pong = await dws.next();
  check('ws ping/pong', pong.type === 'pong' && pong.reqId === 'p1');

  dws.send({ type: 'driver:activate', lat: 51.5074, lng: -0.1278, reqId: 'a1' });
  const st = await dws.next();
  check('driver goes online', st.type === 'driver:status' && st.active === true);

  dws.send({ type: 'driver:location', lat: 51.51, lng: -0.13 });
  dws.send({ type: 'ping', reqId: 'p2' });
  const pong2 = await dws.next();
  check('location update accepted (no error)', pong2.type === 'pong');

  // Rider without a car profile cannot activate.
  const rws = await connectWs(rider.token);
  const rhello = await rws.next();
  check('ws hello for rider', rhello.type === 'hello' && rhello.user.id === rider.user.id);
  rws.send({ type: 'driver:activate', lat: 1, lng: 2, reqId: 'a2' });
  const err = await rws.next();
  check('rider without car cannot go online', err.type === 'error');

  // /api/me reflects the online state.
  const me = await api('GET', '/api/me', null, driver.token);
  check('driverActive reflected in /api/me', me.json.driverActive === true);

  dws.send({ type: 'driver:deactivate', reqId: 'd1' });
  const off = await dws.next();
  check('driver goes offline', off.type === 'driver:status' && off.active === false);

  dws.send({ type: 'nonsense' });
  const unk = await dws.next();
  check('unknown message type -> error', unk.type === 'error');

  dws.ws.close();
  rws.ws.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
