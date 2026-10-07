# DrivePro project requirements

Updated 2026-10-02. This is the current milestone contract; ROADMAP.md retains the
earlier feature decisions and history. TRACK.md records evidence and remaining work.

## Product

DrivePro is a navigation-first carpooling PWA, initially focused on Almaty.
People plan walking, cycling or driving routes, with optional shared lifts along
the way. Drivers and walkers confirm a match before precise contact/location
details are exchanged. A compiled feature is not proof of live availability,
provider delivery, safety or adoption.

Keep the Node server free of runtime npm dependencies and preserve the Expo/React
Native app. Root development dependencies are for repository checks only. Native
store releases remain deferred; this milestone targets the web app.

## L64 — accessible shared controls

1. Shared buttons and interactive chips/rows expose useful names and roles.
   Loading buttons retain their name and expose busy/disabled state. Selection
   uses state appropriate to its role; display-only chips/rows stay noninteractive.
2. Keyboard focus is visible in light and dark schemes. Keyboard activation runs
   once, disabled controls do not activate, and the home menu has no unnamed
   backdrop stop. Check menu dismissal and focus return in a real browser.
3. The shared animations and home pulse respect reduced-motion preferences while
   retaining visible content and working controls.
4. Existing smoke tests and the new L64 regression checks pass; rebuild the web
   bundle and check representative mobile/desktop browser journeys. Report native
   assistive-technology and full-app accessibility checks separately as unverified.
5. Release commits have a meaningful L-numbered subject and body, real commitlint
   validation, verified SSH signatures, and the owner's sole identity. Batch the
   pending map fix and the validated milestone into one ordinary push, verify CI
   for the exact SHA and separately check the deployed app.

## L66 requirement — production authentication boundaries

L65 is the separately published project-overview update; the published L66 commit
adds README artwork. L66 remains the saved authentication task identifier. Its
implementation is included in the proposed L67 release, together with the checked
UI fixes and SDK upgrade. These close specific defects and do not establish
complete product security.

1. An already verified account cannot obtain another session from `/api/verify`
   with an empty, arbitrary or previously used code. Normal password login remains
   available; a first valid verification still consumes its one-time proof.
2. Production never returns `devCode`, including with an old `OTP_ECHO=1` setting,
   across signup, login, resend and password-reset responses. Local development
   and test fixtures retain their explicit development behavior.
3. Missing production SMS configuration cannot silently pretend delivery succeeded
   or write verification codes, recipient numbers or provider response bodies to
   application logs. Existing Telegram signup fallback remains available when
   configured. Provider acceptance in a local stub is not real delivery evidence.
4. Initial provisioning and updates never seed `OTP_ECHO=1`; existing private
   provider configuration is preserved. Runtime enforcement protects installations
   that retain the old override. Document missing-provider behavior and pilot gates.
5. L66 regression checks and the full applicable smoke suite pass on Node 24.19.0,
   including the JSON fallback. Independently review the exact candidate, preserve
   the separately published overview, and release one signed, commitlint-checked
   batch through the existing test/deploy workflow. Verify its exact revision.

Production provider configuration, controlled real delivery and complete signed-in
user journeys require separate evidence. No new account, paid SMS, publication or
outreach is authorized by these local regression tests.

## DP-UI-002 — journey action and error semantics

Local browser evaluation found missing programmatic semantics on saved-commute
and confirmation actions, plus login error text. Preserve the existing visual
identity, translations, callback behavior and account data.

1. Pause/resume and removal expose button roles and localized names that identify
   the commute. Confirmation actions expose their visible purpose as button names.
2. Keyboard focus is visible. Enter and Space activate each action once; cancelling
   keeps the commute, confirming removes it, and pause persists after reload.
3. Visible error text exposes one platform-appropriate announcement mechanism.
   Check the web alert in a real browser; do not infer VoiceOver or native behavior.
4. Retain English, Russian and Kazakh support, run the required regression suite,
   rebuild the web bundle and independently evaluate the exact candidate with
   synthetic local data at desktop/mobile viewport sizes.
5. This web change is separate from the frozen server-only release proposal.
   Existing frontend dependency diagnostics remain unresolved; no release follows
   from local implementation or from approval of a different exact artifact.

## DP-UI-003 — accepted lift pickup address

A two-user browser reproduction found destination text shown as pickup despite
correct pickup coordinates. Fix that accepted-lift path without changing consent
or the server matching contract.

1. Resolve the pickup name from the last position successfully shared for pickup,
   or from the offered meeting point. Never reuse destination or unrelated map text.
2. Snapshot that position before asynchronous lookup and stop further walker
   location broadcasts during acceptance. Keep the label consistent with the
   coordinates accepted under the existing ordered WebSocket flow.
3. A failed, blank, missing or unusable reverse-geocoder result falls back to the
   same pickup coordinates. An unknown position cannot borrow a map label.
4. Execute behavioral regression checks for ordinary/meeting-point pickup,
   lookup failure and movement during lookup. Preserve existing matching tests,
   rebuild the web bundle, run the full suite and independently replay the original
   two-user browser case on the exact candidate.
5. Record local acceptance separately from release. Existing dependency diagnostics
   and exact approval scope remain gates; this web change is outside the pending
   server-only exception. Real GPS/geocoder/device behavior is unverified.

## DP-A11Y-004 — shared input labels

Associate visible form labels with their input fields. Web labels must focus the
intended field and use stable, unique IDs. Preserve explicit caller IDs and naming
props, localized text, unlabelled inputs, phone formatting and callbacks. Preserve
compact typography and spacing: React Native pixel line heights must not become
unitless multipliers in the HTML label. Native
fields receive the visible label as accessibility metadata when no explicit name
exists. Verify rendered login/signup association, focus and phone entry in a real
browser; helper tests alone do not establish assistive-technology behavior.

Run the full serial suite and rebuild the web artifact. Record independent results
in the private supervisor ledger. Real-device and native screen-reader testing
remain separate, and frontend dependency findings still hold release.

## DP-MAP-005 — stable pickup selection

Entering pickup must stop earlier route camera animation and place the pin at the
intended starting point. Test first and repeated selections with immediate and
settled confirmation; compare exact submitted and saved coordinates, not only a
reverse-geocoder label. Preserve deliberate map dragging and cancellation of old
route-fit requests. A synthetic browser GPS fixture is not real GPS evidence.

Retain a behavioral browser regression for the reproduced 123 m drift, including
an intentional drag and a separate saved-row read. Rebuild the web bundle, run the
full serial suite and independently replay the frozen candidate. MapGL and native
physical-device behavior remain separate verification boundaries.

## DP-DEPS-001 — supported frontend dependency upgrade

Move the web app to a compatible supported Expo SDK without replacing React Native
or adding server runtime dependencies. Keep the lockfile reproducible, use the
SDK's supported package versions and migrate obsolete configuration explicitly.
Preserve the app identity, permissions and splash assets. Do not use forced
resolutions or hide audit/deprecation diagnostics.

Run a clean locked install, actual audit, Expo alignment and Doctor checks, web
export/postexport and the full serial smoke suite. Independently replay labelled
authentication, an ordinary UI ride and saved commute on the exact exported build.
Record residual advisories by dependency chain; lower counts do not establish a
clean security gate. Native builds and devices remain outside this web milestone.

## Launch preparation

Prepare screenshots from the actual local build using synthetic data, an accurate
description, a short showcase, social drafts, invitations and a feedback form.
Keep drafts and approval records private in the supervisor's state directory.
Accounts, social posts, invitations and spending require the owner's approval of
the exact content and destination. An approved draft is not a sent message.

Before a public user pilot, verify production OTP echo is disabled, provider
delivery works with controlled test accounts, and the main user journeys pass.
Do not invite real users while these gates remain unknown. Do not claim the app
is impossible to exploit or fully compliant from a limited UI review.

## Authority and continuity

The owner explicitly authorized scoped signed commits, batched ordinary pushes,
and existing push-triggered deployments in the supervisor workflow. Preserve
unrelated local work; do not overwrite the original checkout's design-sync files
or local instructions. Read the installed project-supervisor-workflow skill and
its rules before continuing. Record decisions, evidence and limitations, never
private deliberations or credentials.
