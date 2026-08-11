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

// ------------------------------------------------------------- the ramp ---
//
// Every region of the app used to draw from the same two surfaces, so a
// floating pill, a bottom dock and a menu sheet were all literally the same
// colour and depth had to be guessed from the borders. Each region now has
// its own token, and the tokens are one ordered ladder rather than a bag of
// greys:
//
//   surface  recessed - inputs, segmented tracks, switch tracks
//   bg       the ground everything else sits on
//   sheet    the dock at the bottom of the map, and the menu behind the avatar
//   card     a panel raised over the map
//   chrome   the pills floating at the top - the navbar, blue-cast so it is
//            read as controls rather than as another panel
//
// The values were generated in OKLCH so the ladder is even to the eye rather
// than even in hex: hue and chroma identify the region (259 slate for the
// content ladder, 234 - the palette blue - for chrome and tint) and only
// lightness differs between the two schemes.
//
// Dark inverts light where inverting means something. The ground and the ink
// swap ends of the ramp, and `surface` crosses over: a recessed control sits
// *below* the ground in light and *above* it in dark, because on a dark ground
// an inset darker still is a hole. What does not invert is the direction of
// elevation - a raised panel is lighter than its ground in both schemes, since
// raised things catch light either way - nor the semantic colours, which are
// the city's and stay put. Dark carries more chroma at the same hue, or the
// slate cast washes out to plain grey down there.
//
// Fills are unreadable as body text, so the palette colours that appear as
// type have a scheme-specific readable twin, the way gold/goldFill already
// did: primary/primaryInk, ok/okInk, danger/dangerInk. Every ink - including
// sub - clears WCAG AA (4.5:1) against every region of its own scheme, which
// is what fixed the lightness of each one.

const light = {
  scheme: 'light',
  bg: '#E2E8F3',
  surface: '#CED8E7',
  sheet: '#F0F5FB',
  card: PALETTE.white,
  chrome: '#DBF3FF',
  chromeBorder: '#9ED3F2',
  // A soft primary wash for anything selected - chips, days, mode tiles.
  tint: '#BDE7FF',
  onTint: '#006692',
  text: PALETTE.slate,
  sub: '#535D6C',
  border: '#C4CDDB',
  // Where a hairline has to be seen rather than felt: grab handles, ghost
  // buttons, dividers inside a menu.
  borderStrong: '#A6B2C5',
  primary: PALETTE.blue,
  primaryText: PALETTE.white,
  primaryInk: '#006194',
  accent: PALETTE.crimson,
  // The palette yellow is unreadable as text on white, so light mode uses a
  // darkened version for type and keeps the pure yellow for fills.
  gold: '#6F5C00',
  goldFill: PALETTE.yellow,
  danger: PALETTE.crimson,
  dangerInk: '#AC1B53',
  ok: PALETTE.green,
  okInk: '#006933',
  // Scrims are slate rather than black, so a modal dims the app instead of
  // greying it out.
  overlay: 'rgba(31,41,58,0.42)',
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
  bg: '#131C2A',
  surface: '#202C3E',
  sheet: '#2B3749',
  card: '#3B4759',
  chrome: '#20465A',
  chromeBorder: '#2B6E8F',
  tint: '#064059',
  onTint: '#83D8FF',
  text: PALETTE.white,
  sub: '#B1BBCC',
  border: '#4D5768',
  borderStrong: '#697589',
  primary: PALETTE.blue,
  primaryText: PALETTE.white,
  primaryInk: '#6DC6F6',
  accent: PALETTE.crimson,
  gold: PALETTE.yellow,
  goldFill: PALETTE.yellow,
  danger: '#FF5C93',
  dangerInk: '#FF94B1',
  ok: '#12B45C',
  okInk: '#6FD395',
  overlay: 'rgba(5,9,15,0.62)',
  shadow: 'rgba(0,0,0,0.5)',
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
