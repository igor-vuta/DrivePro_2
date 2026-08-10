# DrivePro — working agreements

Carpooling PWA: zero-dependency Node 22.5+ server (`server/`), Expo React
Native web app (`app/`), Russian as default language, dark cyberpunk-luxury
theme (all tokens in `app/src/ui.js` — bg #06070d, cyan #00e5ff, magenta
#ff2bd6, gold #f5c518).

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
phone proven by Telegram's contact sharing; also delivers codes once linked).

Remaining work and its running order live in `ROADMAP.md`.
