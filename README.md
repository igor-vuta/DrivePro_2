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

Scan the QR code with your phone (iOS: Camera app, Android: Expo Go app).
The app auto-detects the server address from the Expo connection, so no
configuration is needed as long as both run on the same computer.

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

## Milestones

1. **Foundation** — accounts (phone + password), profiles, driver car details,
   Drive mode with online/offline and live location streaming. *(done)*
2. Rider map: pickup/destination pins, address lookup, ride request.
3. Driver order feed: incoming order cards, first-accept-wins matching.
4. Live ride: driver tracking, arrived/start/finish, routes and ETA.
5. Ratings, public profiles, ride history.
6. Visual design pass.

## Technical notes

- The server persists to `server/data/` (SQLite when available, JSON otherwise).
  Delete that folder for a clean slate.
- Auth uses scrypt password hashing and signed JWT-style tokens (30-day expiry).
- Realtime is a hand-rolled RFC 6455 websocket endpoint at `/ws` — no Socket.IO,
  so the mobile side uses the built-in `WebSocket` and the server stays
  dependency-free.
- Maps (milestone 2) use OpenStreetMap tiles with Nominatim geocoding and OSRM
  routing — no API keys required.
