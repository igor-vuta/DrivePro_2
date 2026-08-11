import { Appearance, Platform } from 'react-native';

// Design tokens, in Almaty's own colours - the palette is taken from the
// city's coat of arms (blue, yellow, crimson, slate, green, white).
//
// Light and dark both exist and follow the system: a navigation app is used
// in daylight and at night, and neither is a recolour of the other. `colors`
// is a single mutable object rather than a context value, because ~180 call
// sites already read `colors.x` inline; applyScheme() rewrites it in place
// and the tree re-renders, so nothing else has to change.
//
// Anything built with StyleSheet.create captures its values once, so those
// live in makeStyles(scheme) functions instead - see ui.js.

const PALETTE = {
  blue: '#008FD2',
  yellow: '#FFEF01',
  crimson: '#E83379',
  slate: '#44546C',
  green: '#009744',
  white: '#FFFEFF',
};

const light = {
  scheme: 'light',
  // bg and card were both white, so nothing on the sheet stood up from it -
  // the app read as one flat white field. The ground is now a slate tint and
  // cards stay pure white, which is what makes them look raised.
  bg: '#E9EEF3',
  card: '#FFFFFF',
  // Deeper than the ground, so inputs and chips read as recessed into it
  // rather than floating like cards.
  surface: '#DCE4EC',
  text: PALETTE.slate,
  sub: '#7B8798',
  border: '#C8D3DE',
  primary: PALETTE.blue,
  primaryText: PALETTE.white,
  accent: PALETTE.crimson,
  // The palette yellow is unreadable as text on white, so light mode uses a
  // darkened version for type and keeps the pure yellow for fills.
  gold: '#8A7400',
  goldFill: PALETTE.yellow,
  danger: PALETTE.crimson,
  ok: PALETTE.green,
  // Shadows carry depth in light; glow is reserved for dark, because glow on
  // a near-white ground reads as blur rather than light.
  shadow: 'rgba(44,53,66,0.22)',
  glow: 'transparent',
  // Voyager draws shop, cafe and park names and colours parks and water -
  // denser and more map-like than the near-blank light_all, which was chosen
  // when the map was only a backdrop for picking a point.
  mapTiles: 'rastertiles/voyager',
  statusBar: 'dark-content',
};

const dark = {
  scheme: 'dark',
  bg: '#222B36',
  card: PALETTE.slate,
  surface: '#3A465A',
  text: PALETTE.white,
  sub: '#A9B4C4',
  border: '#55637A',
  primary: PALETTE.blue,
  primaryText: PALETTE.white,
  accent: PALETTE.crimson,
  gold: PALETTE.yellow,
  goldFill: PALETTE.yellow,
  danger: '#FF5C93',
  ok: '#12B45C',
  shadow: 'rgba(0,0,0,0.45)',
  glow: 'rgba(0,143,210,0.45)',
  // No dark Voyager exists; dark_all already carries street names, and a
  // light style under a dark UI would glare at night.
  mapTiles: 'dark_all',
  statusBar: 'light-content',
};

export const schemes = { light, dark };

// Live tokens. Imported by value everywhere; rewritten in place on change.
export const colors = { ...dark };

export function applyScheme(name) {
  const next = schemes[name] || dark;
  for (const k of Object.keys(next)) colors[k] = next[k];
  return colors;
}

export function systemScheme() {
  try {
    return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

// Keeps the browser chrome (and the iOS standalone status bar) in step with
// the app's own background instead of staying on the old near-black.
export function syncDocumentTheme() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', colors.bg);
  const root = document.documentElement;
  if (root) root.style.background = colors.bg;
  if (document.body) document.body.style.background = colors.bg;
}

// ------------------------------------------------------------- spacing ---
//
// Deliberately roomier than the first design: the old 16/12 grid felt tight
// on a phone held one-handed while walking.

export const SCREEN_PAD = 20;
export const CARD_PAD = 20;
export const GAP = 16;
export const INPUT_H = 52;
export const BUTTON_H = 54;
export const RADIUS = 16;
export const RADIUS_LG = 20;
// Height reserved at the top of the home screen for the chrome that floats
// over the content (city pill, streak, avatar). Map-first states cancel it
// with <Bleed top> so the map runs under the chrome to the screen edge.
export const CHROME_H = 52;
export const LINE_HEIGHT = 1.45;

applyScheme(systemScheme());
