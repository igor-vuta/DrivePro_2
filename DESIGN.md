# DrivePro design

The map is the main surface. Navigation controls and the optional shared-ride
flow sit above it; other destinations live in the profile menu. Preserve that
structure and the current product identity when improving the interface.

The current tokens in app/src/theme.js supersede older palette descriptions:
navy brand surfaces, blue selection, apple primary actions, green live signals
and gold points. Use the existing typography ramp, spacing and region tokens in
both system light and dark modes. Rebuild styles after applyScheme changes.

L64 adds semantics, visible focus and reduced-motion behavior without replacing
the established layout or visual identity. Interactive controls need useful
names; loading and selection need programmatic state as well as visual treatment.
Decorative glyphs should not replace names or create extra keyboard stops.

Motion must support orientation and state changes. Honor reduced-motion settings,
including continuous pulses. Decorative 3D animation is outside this map-control
milestone; any later showcase motion must suit this product and retain readable,
usable content when motion is reduced.

Shared reference: ~/Developer/frontend-agent-tooling/README.md. Read relevant
review instructions explicitly and inspect the actual running app. Existing
portfolio and Intelli-Factory examples are references, not a replacement identity.
