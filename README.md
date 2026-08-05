# DrivePro

A peer-to-peer ride app in the spirit of Uber / Yandex Go, with one twist: all rides are free.
Riders drop a pin, describe the pickup, and request a ride. Drivers go online, pick up orders,
drive, and afterwards both sides rate each other.

## Project layout

```
server/   Backend: REST API + websocket realtime hub.
          Zero npm dependencies - plain Node.js (http, crypto, sqlite).
app/      Mobile app: Expo / React Native (SDK 56), tested through Expo Go.
```

## Requirements

- Node.js 18+ (22.5+ recommended — enables the SQLite storage backend;
  older versions fall back to JSON-file storage automatically)
- npm (for the app only; the server needs no install step)
- Expo Go on your phone (App Store / Play Store)
- Phone and computer on the same Wi-Fi network

## Running it

Terminal 1 — the server:

```bash
cd server
npm start
```

Terminal 2 — the app:

```bash
cd app
npm install        # first time only
npx expo start
```

Scan the QR code with your phone (iOS: Camera app, Android: Expo Go app),
or press `w` to open the app in a desktop browser. The app auto-detects the
server address from the Expo connection, so no configuration is needed as
long as both run on the same computer.

Signing up asks for a 4-digit phone verification code. Delivery is mocked
for development: the code prints in the server console and is shown on the
verification screen itself ("Dev code"). Set `OTP_ECHO=0` in the server
environment to hide it; swap `sendCode()` in `server/src/otp.js` for a real
SMS provider to go live.

### Troubleshooting

- **"Can't reach the server"** — check the server terminal is running, and that
  your phone is on the same Wi-Fi. If your network isolates clients, set
  `MANUAL_SERVER_HOST` in `app/src/config.js` to your computer's LAN IP
  (the server prints it on startup).
- **Dependency version warnings** — run `npx expo install --fix` inside `app/`.

## Trying the full flow

Use two accounts (e.g. your phone + the iOS simulator, or two phones):

1. Sign up as a rider on one device.
2. Sign up as a driver on the other, open Profile, fill in car details.
3. Switch the driver to the Drive tab and go online.
4. Request a ride as the rider (from milestone 2 onwards).

## Hosting / sharing with friends

The server can serve the built web app, so one URL is the whole product -
friends open it in any phone browser and can "Add to Home Screen".

Build the web app once (repeat after app changes):

```bash
cd app
npx expo export --platform web     # creates app/dist
```

Restart the server - it now serves the app at http://localhost:4000.

**Share instantly (free, while your computer is on):**

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:4000
```

Send the printed `https://….trycloudflare.com` link to friends. HTTPS means
geolocation works, and the app automatically uses the same origin for the
API and secure websockets - no configuration.

**Host permanently (e.g. Railway, ~$5/mo):** push this repo to GitHub
(commit `app/dist`), create a Railway service from it with start command
`node server/src/index.js`, attach a volume and set `DATA_DIR` to its mount
path. Any Node 18+ host works the same way - the server has no dependencies.

**Point the phone (Expo Go) app at a hosted server:** set `MANUAL_SERVER`
in `app/src/config.js` to the full URL, e.g. `'https://your-app.up.railway.app'`.

## Milestones

1. **Foundation** — accounts (phone + password), profiles, driver car details,
   Drive mode with online/offline and live location streaming. *(done)*
2. **Rider map** — center-pin pickup/destination picking, address search and
   reverse geocoding, route + ETA, nearby drivers live on the map, ride
   request with driver instructions, cancel. *(done)*
3. **Driver order feed** — incoming order cards with rider rating, distances
   and instructions; first-accept-wins matching; matched screens on both
   sides with mutual phone reveal, call buttons and the driver approaching
   live on the rider's map. *(done)*
4. **Live ride** — driver-controlled arrived/start/finish flow, arrival alert
   with vibration for the rider, per-leg routes (to pickup, then to
   destination), live tracking through the whole trip, cancel allowed until
   the trip starts. *(done)*
5. **Ratings & profiles** — skippable post-ride rating (1–5 stars + optional
   comment) for both sides, averages and recent comments on public profiles,
   tappable profiles everywhere (order cards, matched screens, history),
   full ride history with rate-later. *(done)*
6. **Accounts & polish round** — phone verification (mock OTP), profile
   photos, about/email, saved Home/Work places, English/Russian localisation
   with auto-detect, address details (entrance/flat/floor/intercom/note) on
   both ride points, validation on every field, open orders replayed to
   late-connecting drivers, automatic reconnect + re-sync when the app or
   browser tab regains focus. *(done)*
7. Visual design pass (cyberpunk neon).

With milestone 5, the complete flow works: register → profile → request a
ride on the map → match with a driver → pickup → trip → finish → mutual
ratings.

## Technical notes

- The server persists to `server/data/` (SQLite when available, JSON otherwise).
  Delete that folder for a clean slate.
- Auth uses scrypt password hashing and signed JWT-style tokens (30-day expiry).
- Realtime is a hand-rolled RFC 6455 websocket endpoint at `/ws` — no Socket.IO,
  so the mobile side uses the built-in `WebSocket` and the server stays
  dependency-free.
- Maps (milestone 2) use OpenStreetMap tiles with Nominatim geocoding and OSRM
  routing — no API keys required.
