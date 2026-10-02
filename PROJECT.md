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
