# DrivePro workflow tracking

## Current milestone

L64 accessible shared controls. Implementation and local validation are complete
in an isolated worktree. Independent review corrected missing web busy/expanded
states before release. Signed release, exact-revision CI and production checks
are the remaining release gates; no deployment is claimed in this checkpoint.

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

## Outstanding product gates

- Production OTP echo must be confirmed off; the existing deployment script can
  preserve or seed an unsafe echo override. Controlled real delivery remains untested.
- Full keyboard/screen-reader coverage beyond L64, native device behavior, live
  passkeys, matching/navigation journeys, provider availability and load/security
  testing still need evidence.
- Launch assets are drafts. No social accounts, publication or invitations have
  been approved or executed. No feedback metrics or real-user results exist yet.
