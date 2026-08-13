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
  navy: '#072A4E',
  blue: '#1361F0',
  apple: '#C4402A',
  signal: '#EE4B23',
  green: '#13C06A',
  gold: '#FFB300',
  white: '#FFFFFF',
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
// than even in hex, and the ladder itself is deliberately almost colourless.
//
// Every map app is two colours you can name from across the room: Uber is
// white and black, 2GIS white and green, Yandex white and yellow. Ours is
// **navy and blue** - a deep navy brand surface with an electric blue on it.
// The content ladder carries only a trace of chroma (enough that grey does not
// look dead); the saturated colours are all doing a job:
//
//   blue    interactive - anything selected, tappable or linked
//   apple   commit - the button that starts a ride, and the destination it
//           is heading for. Almaty means "father of apples"; the red is the
//           city's, not a generic alert red.
//   green   live - your own position, the pickup, anything happening now
//   gold    points and streaks
//   navy    the brand surface: the sheet header, the ETA pills over the map
//
// Apple carries two weights: `go` is the fill you tap, `signal` is the
// brighter twin used for a marker that has to be found on a busy map.
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
  bg: '#EEF2F7',
  surface: '#DDE4EE',
  sheet: '#F7F9FC',
  card: '#FFFFFF',
  // The floating pills over the map. Blue-cast so they read as controls
  // rather than as another panel; near-white so navy type sits on them.
  chrome: '#F1F6FF',
  chromeBorder: '#C8DAF5',
  // A soft primary wash for anything selected - chips, days, mode tiles, the
  // row you are about to travel to.
  tint: '#E4EDFE',
  onTint: '#0B47B4',
  text: '#0A1F33',
  // Darkened a touch from the mockup's #5A6E86: that value clears AA on card
  // and on the tint, but not on `surface`, which is the deepest ground an ink
  // can land on.
  sub: '#55677E',
  border: '#DCE3EC',
  // Where a hairline has to be seen rather than felt: grab handles, ghost
  // buttons, dividers inside a menu.
  borderStrong: '#AEB9C7',
  primary: PALETTE.blue,
  primaryText: PALETTE.white,
  // The electric blue is a fill; as type it needs darkening to clear AA on
  // every region. Same fill/ink split as gold and apple below.
  primaryInk: '#0F52CC',
  accent: PALETTE.apple,
  // The brand surface: navy, and the only region an ink other than `onBrand`
  // never lands on. It is deliberately outside the light/dark elevation
  // ladder - it is the same navy in both schemes, because it is the brand.
  brand: PALETTE.navy,
  onBrand: PALETTE.white,
  brandSub: '#9DB6D2',
  brandOk: PALETTE.green,
  // Commit: the button that starts a ride, and the destination it heads for.
  go: PALETTE.apple,
  onGo: PALETTE.white,
  // The brighter twin, for a marker that has to be found on a busy map.
  signal: PALETTE.signal,
  // The palette gold is unreadable as text, so light mode uses a darkened
  // version for type and keeps the pure gold for fills.
  gold: '#6B5200',
  goldFill: PALETTE.gold,
  danger: PALETTE.apple,
  dangerInk: '#B03A22',
  ok: PALETTE.green,
  okInk: '#0B7340',
  // Scrims are navy rather than black, so a modal dims the app instead of
  // greying it out.
  overlay: 'rgba(7,42,78,0.42)',
  // Shadows carry depth in light; glow is reserved for dark, because glow on
  // a near-white ground reads as blur rather than light.
  shadow: 'rgba(7,42,78,0.18)',
  glow: 'transparent',
  // Voyager draws shop, cafe and park names and colours parks and water -
  // denser and more map-like than the near-blank light_all, which was chosen
  // when the map was only a backdrop for picking a point.
  mapTiles: 'rastertiles/voyager',
  statusBar: 'dark-content',
};

// Dark is derived from light rather than designed: v2 is a daylight study, and
// a navigation app is used at night. The rules are L54's - the ground and the
// ink swap ends of the ramp, `surface` crosses the ground (a recessed control
// sits below it in light and above it in dark, because on a dark ground an
// inset darker still is a hole), elevation still climbs toward light, and the
// semantic colours stay put. The navy brand surface is the one thing that does
// not move at all: it is already dark, so night simply meets it.
const dark = {
  scheme: 'dark',
  bg: '#0A1420',
  surface: '#16212F',
  sheet: '#1E2A38',
  card: '#2B3949',
  chrome: '#123044',
  chromeBorder: '#2A5A7E',
  tint: '#0C3566',
  onTint: '#A9CDFF',
  text: '#F4F7FA',
  sub: '#A8B6C6',
  border: '#2C3846',
  borderStrong: '#4A5666',
  // Lifted off the light blue: the pure #1361F0 is heavy on a near-black
  // ground, where a fill reads darker than it measures.
  primary: '#2F7BF5',
  primaryText: PALETTE.white,
  primaryInk: '#6DA8FF',
  accent: '#E2543A',
  brand: '#0B2C4C',
  onBrand: '#F4F7FA',
  brandSub: '#9DB6D2',
  brandOk: '#35C07A',
  go: '#E2543A',
  onGo: PALETTE.white,
  signal: PALETTE.signal,
  gold: PALETTE.gold,
  goldFill: PALETTE.gold,
  danger: '#E2543A',
  dangerInk: '#FF9877',
  ok: '#35C07A',
  okInk: '#5FD79B',
  overlay: 'rgba(3,8,14,0.62)',
  shadow: 'rgba(0,0,0,0.5)',
  glow: 'rgba(19,97,240,0.45)',
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

// ---------------------------------------------------------------- type ---
//
// Manrope, self-hosted from app/public/fonts (see manrope.css there for why
// it is not pulled from Google). One variable file per subset, weights
// 500-800; cyrillic-ext is mandatory, because the Kazakh letters live there.
//
// On web a family stack is legal and gives us a fallback while the font
// loads; on native fontFamily must name exactly one family.
const webFont = Platform.OS === 'web';
export const FONT = webFont
  ? 'Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
  : 'Manrope';

// The ramp. Every step is a complete text style - spread it, do not pick at
// it - so a screen never re-decides a size or a weight on its own:
//
//   display   the sheet's headline: "Куда едем?"
//   title     a screen heading, one step under display
//   row       a list row's own name: "Дом", "Работа"
//   body      what someone types or reads at length
//   sub       the secondary line under a title
//   meta      the detail line: "Аль-Фараби 77 · 22 мин"
//   overline  the small caps label above a block: "12 ВОДИТЕЛЕЙ РЯДОМ"
//   button    a CTA label
//   chip      a pill label
//
// The tight negative tracking on the big steps is Manrope's own: it is drawn
// loose, and display sizes need pulling in to stop looking like a banner.
export const TYPE = {
  display: { fontFamily: FONT, fontSize: 29, fontWeight: '800', letterSpacing: -0.9, lineHeight: 32 },
  title: { fontFamily: FONT, fontSize: 22, fontWeight: '800', letterSpacing: -0.4, lineHeight: 26 },
  row: { fontFamily: FONT, fontSize: 15.5, fontWeight: '800', letterSpacing: -0.2, lineHeight: 19 },
  body: { fontFamily: FONT, fontSize: 16, fontWeight: '600', letterSpacing: 0, lineHeight: 23 },
  sub: { fontFamily: FONT, fontSize: 13.5, fontWeight: '600', letterSpacing: 0, lineHeight: 18 },
  meta: { fontFamily: FONT, fontSize: 12.5, fontWeight: '600', letterSpacing: 0, lineHeight: 16 },
  overline: { fontFamily: FONT, fontSize: 11, fontWeight: '800', letterSpacing: 1, lineHeight: 14, textTransform: 'uppercase' },
  button: { fontFamily: FONT, fontSize: 17.5, fontWeight: '800', letterSpacing: -0.2, lineHeight: 22 },
  chip: { fontFamily: FONT, fontSize: 12.5, fontWeight: '800', letterSpacing: -0.1, lineHeight: 16 },
};

// The notch and the home indicator.
//
// These used to be handled once, at the top of every screen, by wrapping
// everything in a SafeAreaView - which is correct for a form and wrong for a
// map: it left a dead band above the map and below the sheet, and no amount of
// negative margin could cancel it, because the inset is a CSS env() value the
// layout never knows the size of.
//
// So the shell publishes the insets as CSS variables (see tools/postexport.mjs)
// and each element decides for itself. The map ignores them and runs to the
// physical edge; the floating chrome and the sheet's controls keep clear.
// Native has no env(), and its SafeAreaView still does the job there.
const web = Platform.OS === 'web';
export const SAFE_TOP = web ? 'var(--sat, 0px)' : 0;
export const SAFE_BOTTOM = web ? 'var(--sab, 0px)' : 0;
// The space the home screen reserves for its floating chrome: the notch plus
// the chrome itself, and the exact negative of it for a full-bleed child.
export const CHROME_TOP = web ? `calc(var(--sat, 0px) + ${CHROME_H}px)` : CHROME_H;
export const CHROME_TOP_NEG = web ? `calc(-1 * var(--sat, 0px) - ${CHROME_H}px)` : -CHROME_H;

applyScheme(systemScheme());
