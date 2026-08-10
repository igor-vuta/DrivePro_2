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
| ~~L20~~ | ~~9 offers vs navigator, 8 floating panels, 10 transitions~~ | ✅ shipped — plus a crash fix, see below |
| ~~L21~~ | ~~12 registration guide~~ | ✅ shipped — the last layer that adds new strings |
| ~~L22~~ | ~~1 Kazakh + RU/ҚАЗ/EN picker, real plurals~~ | ✅ shipped — one sweep, after the string surface stopped moving |
| ~~L23~~ | ~~layout fix (see #7)~~ | ✅ shipped — corrected L19's viewport sizing |
| ~~L24~~ | ~~native push (expo-notifications beside web push)~~ | ✅ shipped — code only; activates on the first EAS build |
| L25 | 2 native builds: Android APK + iOS TestFlight | **needs an Expo login, and $99/yr Apple Developer for iOS** |
| L26 | 4 real SMS provider, then passkeys | **needs a paid KZ SMS provider + keys**; flips prod's `OTP_ECHO` off |

## A. Language & identity

1. ~~**Language picker order + Kazakh**~~ — ✅ L22. Full `kk` dictionary
   (324 keys) beside `ru`; picker reads Авто / РУ / ҚАЗ / EN; `resolveLang`
   maps a kk device to Kazakh and everything unrecognised to Russian. A kk
   miss falls back to **ru, then en** — in Kazakhstan that is the useful
   order. ⚠️ Machine-assisted translation reviewed by the author, not a
   native speaker: tone and idiom deserve a native pass.
   Also landed: real plural forms. `app/src/plurals.js` holds the rules (RN-
   free so `smoke24` can unit-test them), count keys are `key.one/.few/.many`,
   and `t()` picks the variant from `params.n`. Server-side push strings are
   still RU only.
   Not covered: `home.cityLine` interpolates three separate counts in one
   string, which one plural category cannot express — it needs splitting
   before it can be made grammatical for n = 1.

## B. Native app

*(L24 — native push — is done; see below. The builds themselves are L25.)*

2. **Real phone app, not web app** — `app/app.json` already carries both
   identities (`com.igorvuta.drivepro`, iOS location usage string), so this
   is an accounts problem, not a code one.
   - **Android** — `eas build -p android --profile preview` → APK you can
     send to anyone. Free; needs `eas login` only.
   - **iOS** — every build must be signed against an Apple account. For
     testers that means the **Apple Developer Program ($99/yr)** and
     TestFlight (100 internal testers, builds expire after 90 days). The
     free routes are Simulator-only builds or an Xcode sideload that dies
     after 7 days, so neither reaches other people.
   - Native push landed separately in L24, so a native build is no longer a
     downgrade from the PWA.
   - Before any **public** App Store release: privacy policy URL and in-app
     account deletion (Apple 5.1.1(v), mandatory once you offer signup) —
     the app has neither today.

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
12. ~~**Registration guide**~~ — ✅ L21. Four steps in `GuideScreen.js`:
    what DrivePro is (people read it as a taxi app), then each role, then
    points/streaks — the reward loop means nothing before you know what
    earns them. Shown once (`drivepro.guideDone`), skippable, and placed
    between verification and the permission ask so that ask arrives with
    context. It deliberately does not list permissions itself; the existing
    screen does that next. `smoke23` also enforces EN/RU key parity across
    the whole dictionary, which is the guard L22 will lean on.

## D. UI / UX

7. ~~**Bottom-margin overlap in the web app**~~ — ✅ L19, corrected in L23.
   L19's `100dvh` was the wrong tool: in an iOS **standalone PWA** the unit
   comes back short of the web view, so the app ended ~13% above the bottom
   of the screen with a dead band below it (reported from a real phone —
   desktop Chrome cannot show this, as flagged at the time).
   L23 drops viewport-height units entirely: `#root` is
   `position:fixed; inset:0; height:auto`, laid out against the layout
   viewport, so it fills whatever the browser or home-screen shell gives and
   follows it when that changes. `Screen` pads with
   `env(safe-area-inset-top/bottom)` on web — the top inset matters now that
   the root can cover the status bar. `smoke21` pins the whole contract.
8. ~~**Use the full screen**~~ — ✅ L19 + L20. L19 turned the duplicated
   `marginHorizontal: -16` into `Bleed`/`SCREEN_PAD`; L20 made the online
   driver's map full-screen with the status, follow and go-offline controls
   as floating `Chip`s and the km/ETA strip floating above the sheet.
   The rider's RideTab still stacks map-over-panels — fine there, since
   picking a point wants the form visible.
9. ~~**Driver: offers vs navigator**~~ — ✅ L20, as a bottom sheet rather
   than a second page: offers live in a panel floating over the map,
   collapsed to a header with the count, tapped (or auto-opened on arrival,
   with a buzz) to expand. Applies to both the online map and the convoy
   view, so a corridor rider mid-convoy no longer hides below the fold.
10. ~~**Transition animations on key buttons**~~ — ✅ L20. New `Pop` in
    `ui.js` (200ms, existing `Easing.out(Easing.cubic)`) on going online,
    the convoy growing after an accept, requesting a ride, and each ride
    status change through to finish; the sheet animates its own open/close.

11. ~~**Professional placeholder data**~~ — ✅ L19. Car placeholders moved
    out of `ProfileScreen.js` into i18n (`Toyota` / `Camry` / `White` /
    `777 ABC 02`, 02 = Almaty), city example London → Almaty, name example
    Igor → Aigerim. KK versions land with the rest in L22.

### Found while building L21

- ~~**Flaky suite: smoke18 pause/resume**~~ — ✅ fixed. The second schedule
  was created already due, so on a slow runner the 250ms sweeper tick beat
  the pause request: the ride spawned, `paused schedule never fires` failed,
  and the once-per-day guard then blocked the resume — whose bare `await`
  threw `ws timeout` and killed the process mid-suite. It now creates that
  schedule while the rider is still on the first ride (the sweeper skips busy
  riders *without* marking them spawned), so the pause cannot lose the race.
  `DRIVEPRO_SCHED_SWEEP_MS=5 node server/tests/smoke18.mjs` reproduces the
  old failure deterministically and passes on the fix.

### Found while building L20

- ~~**Crash: stopping a location watch killed the web app**~~ — ✅ fixed in
  L20. expo-location 19.0.8's *web* `LocationEventEmitter` is the modern
  expo-modules-core `EventEmitter`, which has no `removeSubscription()`,
  so `subscription.remove()` threw and React unmounted everything. Drivers
  hit it on accept, go-offline and leaving the Drive tab. `stopWatching()`
  in `app/src/location.js` swallows exactly that error; `smoke22` pins the
  contract. Remove the shim when expo-location fixes the web emitter.
- ~~**Plural forms**~~ — ✅ L22, see item 1.

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
