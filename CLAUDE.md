# DrivePro — working agreements

Carpooling PWA: zero-dependency Node 22.5+ server (`server/`), Expo React
Native web app (`app/`), Russian as default language.

Design tokens live in `app/src/theme.js`, in Almaty's own colours (taken from
the city's coat of arms): `008FD2` primary · `FFEF01` points · `E83379`
destination · `44546C` slate · `009744` pickup · `FFFEFF` white. **Light and
dark, following the system.** `colors` is one mutable object rewritten by
`applyScheme()`; anything built with `StyleSheet.create` must live in a
`makeStyles()` function and be rebuilt by `refreshStyles()`, or it will
capture the old scheme.

## Git rules (strict)

- Every commit SSH-signed. Signing key: `~/.ssh/id_ed25519_signing`
  (passphrase-free copy for tooling: `~/Developer/secure-keys/id_ed25519_signing`).
- Sole author and committer: `igor-vuta <261066289+igor-vuta@users.noreply.github.com>`.
  NO Co-Authored-By or any other trailers, ever.
- One commit per layer/feature; message style `L<N> <name>: <what shipped>`.
  Push after each — CI then tests and auto-deploys.

## Tests — must pass before any commit

- `bash server/tests/run-all.sh` runs every smoke suite (handles the live
  server that `smoke.mjs` needs). Requires Node 22.5+.
- Every new layer ships its own `server/tests/smoke<N>.mjs` in the existing
  style: spawn the server on a unique 41xx/42xx port with a `.tmp-data<N>`
  DATA_DIR, `check()` assertions, `N passed, M failed` summary, exit code.

## Web build

- Rebuild whenever `app/src/**` or `app/public/**` changes:
  `cd app && npx expo export -p web && node tools/postexport.mjs`
- `app/dist` is committed on purpose (hosts serve it with no Expo
  toolchain). The export renames the hashed bundle — commit the rename,
  never leave two bundles.
- Icons regenerate with `python3 app/tools/make-icons.py` (Pillow + numpy).

## Server conventions

- Zero npm dependencies, ever. Storage is `node:sqlite` with a JSON-file
  fallback: `server/src/store.js` has two backends + a facade — keep all
  three in sync. Schema changes go in the CREATE TABLE *and* `_migrate()`;
  indexes on migrated columns only after `_migrate()` adds the columns.
- Every user-facing string goes through `app/src/i18n.js`, EN + RU.
- API errors: `httpError(status, message, 'snake_code')` with a matching
  `err.<snake_code>` key in both i18n languages.

## Deployment

- Prod: Oracle Cloud VM (Ubuntu, x86), systemd service `drivepro`, repo at
  `/opt/drivepro/repo`, all state in `/opt/drivepro/data`, Caddy TLS at
  https://drivepro-almaty.duckdns.org. Runbook: `deploy/DEPLOY.md`.
- Environments: dev = `./start.sh` (no `NODE_ENV`), test = `run-all.sh`
  (`NODE_ENV=test`), prod = the VM (`NODE_ENV=production`). The OTP echo
  (`devCode` in auth responses) is off by default under
  `NODE_ENV=production`; `OTP_ECHO=1|0` overrides. Prod sets `OTP_ECHO=1`
  only until real SMS lands — see the Environments table in DEPLOY.md.
- CI/CD: `.github/workflows/deploy.yml` — push to main ⇒ full smoke suite
  ⇒ SSH auto-deploy via `deploy/update.sh` (secrets `DEPLOY_HOST`,
  `DEPLOY_SSH_KEY`).

## State (as of L16)

L1–L9 core (auth/OTP, rides, matching, convoy, navigator, safety, trust
kit) · L10 web push (VAPID + RFC 8291, sw.js) · L11 identity/install (icon,
PWA manifest, eas.json) · L12 streaks (×1.25/1.5/1.75/2 at 3/7/14/30 days)
+ live city impact · L13 invite-code crews + weekly standings · L14
scheduled & recurring rides (sweeper spawns ~10 min before departure) ·
L15 deploy kit · L16 CI/CD · L17 env separation + admin panel fix · L18
auth hardening (password rules, phone mask, OTP password reset) · L19
mobile viewport (100dvh + safe area), `Bleed`/`SCREEN_PAD`, KZ placeholders ·
L20 driver full-screen map + floating offer sheet, `Pop`/`Chip` motion,
expo-location web teardown crash fixed (`app/src/location.js`) · L21
first-run guide (4 steps, once, before the permission ask) · L22 Kazakh
(`kk` dictionary, Авто/РУ/ҚАЗ/EN picker, kk→ru→en fallback) + real plural
forms (`app/src/plurals.js`, `key.one/.few/.many` selected by `params.n`) ·
L23 layout fix: `#root` is `position:fixed; inset:0` (no viewport-height
units — `100dvh` reports short inside an iOS standalone PWA) · L24 native
push (Expo push tokens beside web push; `push_subs` tells them apart by
`kind` in the JSON, no schema change; `EXPO_PUSH_URL` is a test seam) · L25
real SMS via Twilio (`server/src/sms.js`, zero deps; `TWILIO_*` in
`/etc/drivepro.env` only — configuring it turns `OTP_ECHO` off by itself) ·
L26 Telegram (`server/src/telegram.js`, long-polled bot, deep-link nonce,
phone proven by Telegram's contact sharing; also delivers codes once linked) ·
L27 TOTP (`server/src/totp.js`, RFC 4226/6238, zero deps; optional second
factor — the verified phone stays identity and recovery, and a password reset
over it clears the secret) · L28 passkeys (`server/src/webauthn.js`, own CBOR
+ COSE + signature verification, zero deps; `rpId` from `PUBLIC_ORIGIN`) · L29 design system (Almaty palette, light+dark,
airier spacing) · L31 multi-profile routing (`geo.js` car/foot/bike, OSRM
profiles + FOSSGIS fallback; `deploy/setup-osrm.sh` self-hosts, run attended) ·
L30 + L33 security audit fixes (XFF trusted only from
`TRUSTED_PROXIES`; ban/reset evict live sockets + bump `token_epoch`; per-frame
WS re-auth; opaque map-driver ids; push-sub ownership; TOTP matched-step burn;
geo/push/passkey rate limits; sanitized 500/WS errors; uniform reset/request) ·
map-first, in two commits: the ride flow (`landing → mode → pickup → confirm`;
`loadModeRoutes` fetches all three profiles at once; `goTo()` moves map and
`center` state together so a named pick cannot be confirmed against the old
point) and L34 the shell (chrome floats over the map, avatar sheet replaces the
Ride/Drive tab bar, `CHROME_H` reserved at the top and given back by
`<Bleed top>` in full-screen-map states).

L35 + L36 map-first review fixes (10 confirmed
findings from a four-reviewer adversarial pass: back-navigation restoring
labels without coordinates, a `fitSeq` counter revoking in-flight fitBounds
on every navigation, `box-none` re-armed by a full-width child, chrome
overlaps) · L37 `SchedulesScreen` + L38 `CrewScreen` behind the avatar sheet
(`CrewCard` shared with the profile) · L39 OSRM self-hosted on the VM
(car/foot/bike graphs on localhost 5000-5002, `--mmap=1` mandatory on its
956 MB of RAM; FOSSGIS stays the per-request fallback; `update.sh` health
check now retries for 60 s so a slow boot cannot redden CI).

L40 worldwide routing fallback (regional graph first, FOSSGIS on error or a
waypoint snapped past `OSRM_SNAP_MAX_M`) · L41 live navigation (`app/src/nav.js`
holds the pure model; `/api/geo/route?steps=1` returns compact maneuvers; on web
the position watch uses `navigator.geolocation` directly, the expo wrapper never
fires there) · L42 driving as a toggle on your own car route (car form asked once
in place) · L43 pickup along the way (`hub.walkers` + `walk:*` messages;
`fitsDriverRoute` reused so the corridor rule is shared; ~100 m stable fuzz and
opaque ids until both sides confirm, then an ordinary accepted ride).

L44 the pickup toggle mid-route (a `live` state, not a ref, so the nav bar
reacts) · L45 alternative car routes (`?alts=N`; MLD does serve them, no rebuild
needed) · L46 places via 2GIS (`server/src/places.js`, `TWOGIS_KEY` on the VM
only, `/api/places/{search,near,at,:id}` returning a provider-neutral shape;
`placesProvider` in `/api/me` — deliberately not `places`, which the user object
already uses for saved Home/Work).

Layer numbering slipped once: the ride-flow commit is labelled **L32** but
lands after L33. Next free number is **L47**.

L51 basemap: two engines behind one command protocol in `app/src/MapView.js` -
2GIS **MapGL** where a key allows, CARTO raster through Leaflet otherwise, and
the raster one is the floor rather than a degraded mode. MapGL's key must reach
the browser (the tiles authenticate from there), so it travels in `/api/me` as
`mapKey` and lives in its own `TWOGIS_MAP_KEY`, ideally a second domain-restricted
key; with only `TWOGIS_KEY` set it is reused and boot warns. 2GIS publishes **no
dark style** anyone can reference - one is authored in their Style Editor and
named by `TWOGIS_MAP_STYLE_DARK`, and without it the night map stays raster.
MapGL is `[lng, lat]`; every crossing happens inside that one template.

L52 ops: `deploy/backup.sh` (nightly, `sqlite3 .backup`, verified after
writing, 14 kept) and `deploy/watchdog.sh` (service/disk/backup-age, alerts over
the existing Telegram bot via `ALERT_TELEGRAM_CHAT_ID`, reports once per state
change), both installed by `deploy/setup-ops.sh` which `update.sh` re-runs every
deploy. Security updates are automatic; **reboots deliberately are not**.

L53: the pre-L42 second driver window is gone - `DriveTab` is now only what a
driver sees while carrying passengers, and `HomeScreen` sends them back to the
one flow when the last passenger is out (it used to strand them). The places
cache now lives a day (a week for buildings), keys round to ~1 km so neighbours
share answers, and it persists to `DATA_DIR/places-cache.json` so a deploy does
not spend the 1,000/month quota re-answering.

Remaining work and its running order live in `ROADMAP.md`.
