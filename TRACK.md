# DrivePro workflow tracking

## Current milestone

L67 combined release preparation: authentication hardening (saved requirement L66),
control/error semantics, associated input labels, correct lift pickup text, stable
pickup-camera selection and the supported Expo SDK57 upgrade. Remote L66 is the
published README artwork commit and remains preserved.

Revalidated 2026-10-07 on Node 24.19.0: all 50 serial smoke invocations pass,
Expo package alignment passes, Doctor passes 21/21, and web export/postexport pass.
Compatible lockfile updates move Expo to 57.0.27 and shell-quote to 1.12.0,
clearing the newly reported critical shell-quote advisory. The exported bundle is
byte-identical to the independently reviewed SDK57 build.

The fresh audit retains 23 affected package entries (15 high, 8 moderate,
0 critical) from three advisory roots: braces, node-forge and uuid. The locked
install still reports uuid deprecation. These diagnostics remain visible and need
an exact release exception; the earlier two-advisory decision does not cover the
new braces finding or revised lockfile. Final independent review and release
receipts belong in the private supervisor ledger. No deployment is claimed here.

## Verified starting point — 2026-10-02

- Local main: 7173b706fa304190d4296bfe277e77da067cf9b1, one commit ahead of
  origin/main at 7877f73760b346bdc36a69e7793ad8cd7e02b39a.
- The pending map-provider commit is SSH-signed and fixes both raster call sites.
  Its legacy session trailer needs removal before the managed release batch.
  Preserve the original commit under a backup ref before changing its message.
- Latest remote test/deploy run 31751755831 passed for 7877f73. This is baseline
  evidence, not CI verification of the new milestone.
- The original .gitignore edits, .design-sync/, AGENTS.md and MAP_PROVIDER_TASK.md
  predate this milestone and are outside its edits.
- The saved read-only scope audit was independently accepted. Source inspection
  found missing control semantics and reduced-motion handling; browser baseline
  confirms authentication controls appear as generic elements.
- Public root and health returned HTTP 200 during read-only inspection. Production
  revision, OTP configuration, message delivery and rider/driver flows are unknown.

## Local evidence — 2026-10-02

- All 46 smoke invocations passed on Node 24.19.0, including the JSON-store auth
  rerun and 13 L64 assertions. Test logs contain no Node warnings.
- Fresh Expo web export and postexport passed without warnings. Generated bundle:
  `index-1f4a4ace5a70af992a055f40e2ab4b50.js`.
- Chromium at 390x844 and 1440x1000 rendered login, map and menu. Screenshots were
  visually inspected. Keyboard menu opening/dismissal/focus return, light/dark
  focus outlines, reduced-motion menu and the saved-commutes empty state passed.
- An intentionally held local login request retained its name, exposed busy and
  disabled states, and repeated Enter produced one request. Disabled login did
  not activate. Main browser console check reported zero warnings/errors.
- Actual commitlint accepted valid subjects with bodies and rejected missing
  bodies, wrong subjects and attribution/session trailers. Root tooling audit
  reported zero known vulnerabilities; this is not a whole-app security audit.
- The private feedback form passed save/reload/download/schema/consent/deletion
  checks using two synthetic responses, then deleted them.
- Private descriptions, showcase, screenshots, social drafts and invitations are
  stored outside the public repository in the supervisor's project state.

## Release decisions

- Use Node 24.19.0 for local validation and CI. Node 22.23.3 emits the SQLite
  experimental warning; Node 24.19.0 loads it without that warning. The deployed
  host's runtime is not changed by this decision.
- Add root-only commitlint tooling using the existing L-numbered subject style.
  Keep server runtime dependencies at zero and retain every required smoke suite.
- One validated push for the map fix and L64 conserves Actions runs. Verify both
  test and deployment results and the served bundle before claiming deployment.

## L66 candidate — 2026-10-03 Almaty

The isolated candidate rejects session issuance for an already verified phone at
`/api/verify`, including empty, arbitrary and replayed codes. Production ignores
legacy OTP echo overrides and fails missing/partial SMS delivery without printing
code bodies or raw provider errors. Provisioning and updates no longer seed the
unsafe override. Local mock verification and Telegram signup fallback remain.

Independent L66 checks pass 24 assertions on each storage backend. The full serial
suite passes 47 invocations, including the JSON auth rerun, without Node warnings.
The original session bypass was reproduced using a synthetic local account. One
worker cooldown timing assertion failed under concurrent load, then passed alone;
the full serial run also passed. The first failure is retained in private evidence.

Web export and postexport pass and produce the unchanged committed web artifacts.
However, a clean app dependency install reports deprecated inflight, rimraf, glob
and uuid chains; its audit reports 20 findings (9 moderate, 11 high). These are
unresolved release gates, not a clean dependency/security result. No forced major
overrides, unsafe SDK downgrade or diagnostic suppression was applied. The scoped
authentication implementation is independently verified; release requires either
remediating those gates or an explicit owner exception for this server-only patch.

The existing remote L65 overview and header are retained. No live provider send,
new real account or full production journey was tested. Direct read-only SSH
inspection was denied by public-key authentication; no credentials were changed.
Private supervisor evidence records the exact candidate and subsequent decision,
commit, CI and deployment outcomes separately. Full development is unfinished.

## Outstanding product gates

- The deployed production OTP configuration remains unverified. L66 removes unsafe
  seeding and blocks production echo in the candidate; release and live confirmation
  are pending. Controlled real delivery remains untested.
- Full keyboard/screen-reader coverage beyond L64, native device behavior, live
  passkeys, matching/navigation journeys, provider availability and load/security
  testing still need evidence.
- Launch assets are drafts. No social accounts, publication or invitations have
  been approved or executed. No feedback metrics or real-user results exist yet.


## DP-UI-002 candidate preparation — 2026-10-03 Almaty

A separate candidate based on 2456cba preserves the published README/artwork and
copies the exact reviewed authentication changes without altering their frozen
workspace or approval. The commute controls now expose localized action names,
confirmation actions expose button semantics/focus, and shared error text exposes
one web/native announcement property set. Smoke68 executes state/translation and
platform-prop checks; it is registered beside smoke66 in the full suite.

Worker checks pass smoke64 (13), smoke68 (6) and a clean web export/postexport.
At this preparation checkpoint the full suite and independent rendered keyboard
checks remain pending; subsequent results belong in the private supervisor ledger.
No physical-device, VoiceOver, provider, complete-route or full-app readiness
claim is made. Frontend dependency gates remain unresolved. This web change is
outside the existing server-only exception; no commit, push or deployment is
claimed. Remote documentation used L66, so final release numbering must be
reconciled without rewriting the frozen proposal or published history.


## DP-UI-003 candidate preparation — 2026-10-03 Almaty

The separate candidate tracks the last successfully published walker position,
resolves the accepted pickup address from an immutable copy of it or the offered
meeting point, and falls back to those coordinates when lookup fails. It no longer
uses stale destination text. Existing server consent/matching behavior is preserved.

Focused checks pass smoke69 (12) and existing matching smoke35 (19); web export
and postexport pass on Node24.19.0. At this preparation checkpoint the full serial
suite and independent browser replay are pending. Results belong in the private
supervisor ledger without modifying this evaluated artifact. Prior candidates and
unrelated original files are preserved. No commit, push, deployment, real-provider
or physical-device claim follows; frontend dependency gates remain unresolved.


## DP-A11Y-004 candidate preparation — 2026-10-03 Almaty

Shared labelled inputs now render associated HTML labels and stable IDs on web,
and native fields receive visible-label accessibility metadata unless the caller
supplies a name. Phone masking and existing explicit naming remain unchanged.
Smoke70 exercises association policy and phone behavior and is registered in the
full suite. Worker checks pass 12 focused and 6 existing semantics assertions;
web export/postexport pass. Full serial checks and independent browser validation
follow this preparation snapshot; their results belong in the private ledger.
No native-device, release, deployment or production-readiness claim is made.

The first label candidate passed naming checks but failed visual review: raw HTML
interpreted React Native line-height as a multiplier and enlarged each label to
200px. A separate correction converts the line height to pixels. Focused checks
now pass 13 assertions, and worker browser measurements restore 16px labels and
8px field spacing at mobile/desktop sizes. The initial failure remains in the
private evidence; full corrected-suite and independent results follow separately.


## DP-MAP-005 candidate preparation — 2026-10-03 Almaty

Pickup entry now centers without animation, retaining manual map movement and
existing stale-route cancellation. The worker's five actual UI cases cover fresh
and repeated immediate/settled confirmation and one deliberate drag. Default
pickups remain within 0.591 m of fixed synthetic GPS; the manual drag moves pickup
290.738 m. Every UI POST matches a separate saved-schedule GET exactly.

Focused schedule/matching/pickup-label checks pass 21/19/12 assertions and the
web build passes. Full serial checks and independent replay follow this snapshot;
results are kept in private supervisor evidence. Real GPS, roads, MapGL and native
devices remain unverified. Existing dependency gates still hold release.


## DP-DEPS-001 candidate preparation — 2026-10-03 Almaty

The separate candidate aligns Expo 57.0.26, React 19.2.3 and React Native 0.86.3,
uses the supported webview version and migrates splash configuration to the
supported plugin. Removed configuration keys are no longer supported by this SDK;
existing image, color, identity and location permissions are preserved.

A clean locked install and web export/postexport pass; Expo alignment is clean and
Doctor passes 21/21 checks. Initial dependency/schema failures remain in private
evidence. Final audit exits 1 with 13 affected package entries (4 high, 9 moderate),
from node-forge 1.4.0 and uuid 7.0.3 through Expo tooling ancestry. These are two
root advisories, not 13 independent advisories; uuid also retains a deprecation
warning. No forced overrides or diagnostic suppression were used.

Full serial checks and independent browser replay follow this preparation snapshot.
Their results belong in the private ledger. Earlier label and pickup-camera fixes
have passed independent local review. Release remains held on the residual
findings; the older server-only exception cannot authorize this web candidate.
Native devices, deployed provider delivery and public-pilot readiness remain
separate. No commit, push, deployment or publication is claimed.


## L67 numbering reconciliation — 2026-10-03 Almaty

Saved task IDs and historical candidate evidence retain L66 for authentication.
The published L66 README animation and overview are preserved. The proposed next
release is L67. This release-preparation snapshot changes only PROJECT, TRACK and
ROADMAP wording relative to the verified SDK candidate; all executable sources,
lockfiles and exported web artifacts remain byte-identical. The exact source
manifest, final independent evidence, exception decision and release receipts stay
in the private supervisor ledger. A pending exception is not authorization.
