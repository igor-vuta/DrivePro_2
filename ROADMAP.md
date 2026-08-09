# DrivePro — roadmap (post-L16 backlog)

Work these as layers (L17, L18, …): one signed commit per item or coherent
group, smoke test per layer where logic changes, push → CI tests & deploys.
Conventions live in CLAUDE.md.

## Running order

| Layer | Items | Rationale |
| ----- | ----- | --------- |
| ~~L17~~ | ~~13 env separation, 14 admin Enter~~ | ✅ shipped — small, and the OTP-echo gate must exist before real SMS |
| ~~L18~~ | ~~6 password rules, 5 phone mask, 3 forgot password~~ | ✅ shipped — one coherent auth surface |
| ~~L19~~ | ~~7 `100dvh`/safe-area, 11 placeholders~~ (8 partly) | ✅ shipped — pure client; the most visible daily annoyances |
| L20 | 9 offers vs navigator, 8 floating panels, 10 button transitions | biggest UX change; wants L19's layout underneath |
| L21 | 12 registration guide | the last layer that adds new strings |
| L22 | 1 Kazakh + RU/ҚАЗ/EN picker | one translation sweep, after the string surface stops moving |
| L23 | 2 Android APK via EAS | **needs an Expo account login** |
| L24 | 4 real SMS provider, then passkeys | **needs a paid KZ SMS provider + keys**; flips prod's `OTP_ECHO` off |

## A. Language & identity

1. **Language picker order + Kazakh** — RU first (default), then KK, then EN.
   Add a full `kk` dictionary in `app/src/i18n.js` (mirror the `ru` keys),
   extend `resolveLang` + the Profile `Segmented` (RU / ҚАЗ / EN), and the
   server-side RU strings in push notifications stay RU for now.

## B. Native app

2. **Real phone app, not web app** — Android first via the existing
   `app/eas.json` (`eas build -p android --profile preview` → APK;
   package `com.igorvuta.drivepro`). Needs an Expo account login. Native
   push (expo-notifications) is a separate follow-up — web push (L10)
   doesn't run inside the native shell.

## C. Auth & onboarding

3. ~~**Forgot password**~~ — ✅ L18. `POST /api/reset/request` +
   `/api/reset/confirm`, reusing the OTP machinery, the resend cooldown and
   the L8 lockout; completing a reset also verifies the phone. Sub-flow on
   the login card. Note: existing JWTs stay valid after a reset — there is
   no token version to invalidate them, worth adding with passkeys (#4).
4. **Real OTP + second factor** — replace the dev-echo OTP with a real SMS
   provider (Twilio/Vonage/SMSC — pick by KZ delivery + pricing; keys via
   env, never committed). Then passkeys (WebAuthn) as optional strong auth:
   `navigator.credentials` on web; store credential public keys in a new
   table.
5. ~~**Phone input formatting**~~ — ✅ L18. `PhoneInput` + `formatPhone` in
   `app/src/ui.js`; a complete `8XXXXXXXXXX` is rewritten to `+7`. Still
   only wired into the auth screens — reuse it anywhere else a phone is
   typed.
6. ~~**Strong password validation**~~ — ✅ L18. `passwordProblem()` in
   `server/src/util.js`, mirrored client-side: min 8, letter (`\p{L}`, so
   Cyrillic counts) + digit, and not your own phone number. Enforced on
   register and reset; login is untouched so old accounts keep working.
   KK strings land with the rest in L22.
12. **Registration guide** — 2–3 step first-run explainer (what DrivePro
    is, how points/streaks work, permissions it will ask for), shown once
    (AsyncStorage flag), skippable.

## D. UI / UX

7. ~~**Bottom-margin overlap in the web app**~~ — ✅ L19. `postexport.mjs`
   emits `html,body,#root{height:100%;height:100dvh}` after Expo's reset,
   plus `overscroll-behavior:none`; `Screen` adds
   `env(safe-area-inset-bottom)` padding on web (SafeAreaView is a plain
   View there). `smoke21` asserts the shipped `index.html` keeps all of it.
   ⚠️ **Verified in desktop Chrome only** — the overlap it fixes needs a
   real mobile browser with a collapsing URL bar to confirm.
8. **Use the full screen** — *partly done in L19*: the duplicated
   `marginHorizontal: -16` is now a `Bleed` component built on the exported
   `SCREEN_PAD`, and the map still reaches both edges. What remains is the
   design change — panels floating *over* the map instead of sitting in a
   column below it. Overlaps #9, so do them together in L20.
9. **Driver: offers vs navigator** — while driving a route, incoming offers
   are unusable because the navigator map owns the screen. Split into two
   views: a full-screen navigator page and a separate offers list/page,
   with a badge + vibration when new offers arrive (extend the L7 corridor
   toast into a persistent list).
10. **Transition animations on key buttons** — extend the L6 motion system
    (`FadeIn`, spring presses in `ui.js`) to: request ride, go online,
    accept offer, finish ride. Keep durations ≤240ms, use the existing
    easing curves.
11. ~~**Professional placeholder data**~~ — ✅ L19. Car placeholders moved
    out of `ProfileScreen.js` into i18n (`Toyota` / `Camry` / `White` /
    `777 ABC 02`, 02 = Almaty), city example London → Almaty, name example
    Igor → Aigerim. KK versions land with the rest in L22.

## E. Ops & bugs

13. ~~**Dev / test / prod separation**~~ — ✅ L17. `OTP_ECHO` now defaults
    off under `NODE_ENV=production` with an explicit override and a loud
    boot warning; `run-all.sh` pins `NODE_ENV=test`; `update.sh` backfills
    the new env keys; environments table in `deploy/DEPLOY.md`. Still open
    as an option: a `staging` branch deploying to a second port on the VM.
14. ~~**Bug: admin token Enter does nothing**~~ — ✅ L17, and it was worse
    than reported: a `\'` inside the `ADMIN_HTML` **template literal**
    collapsed to a bare quote, so the served `<script>` was a syntax error
    and *nothing* on the panel worked — Enter, the button and Ban alike.
    Inline handlers now quote with `&quot;`; the token input lives in a
    `<form onsubmit>` so Enter and the button take one path; bad tokens say
    so instead of failing silently. `smoke19.mjs` compiles the served
    script, which is what catches this class of bug.
