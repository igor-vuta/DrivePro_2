// Follow-along navigation model (L41). Pure functions over a route with
// steps, so the maths is testable without a map or a GPS.
//
// The model precomputes cumulative distances along the polyline and pins each
// OSRM maneuver to its nearest vertex. Progress is then "which vertex am I
// nearest to": remaining distance is the tail of the cumulative array, the
// next banner is the first maneuver ahead of that vertex, and being far from
// every vertex for a while means the user has left the route.

export function haversineM(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

// route: { points: [[lat,lng],...], distanceM, durationS, steps?: [...] }
export function buildNavModel(route) {
  const points = route.points || [];
  const cum = new Array(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    cum[i] =
      cum[i - 1] +
      haversineM({ lat: points[i - 1][0], lng: points[i - 1][1] }, { lat: points[i][0], lng: points[i][1] });
  }
  const total = cum.length ? cum[cum.length - 1] : 0;
  // Pin each maneuver to its nearest vertex, and keep them in route order.
  const steps = (route.steps || [])
    .filter((s) => Array.isArray(s.loc))
    .map((s) => {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < points.length; i++) {
        const d = haversineM({ lat: s.loc[0], lng: s.loc[1] }, { lat: points[i][0], lng: points[i][1] });
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return { ...s, vertexIdx: best };
    })
    .sort((a, b) => a.vertexIdx - b.vertexIdx);
  return { points, cum, total, steps, durationS: route.durationS || 0, distanceM: route.distanceM || total };
}

// pos: {lat, lng} -> where along the route the user is.
export function progress(model, pos) {
  const { points, cum, total, steps } = model;
  if (!points.length) return null;
  let idx = 0;
  let offM = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = haversineM(pos, { lat: points[i][0], lng: points[i][1] });
    if (d < offM) {
      offM = d;
      idx = i;
    }
  }
  const remainM = Math.max(0, Math.round(total - cum[idx]));
  // The first maneuver still ahead. "depart" is where you already are, and
  // the final "arrive" is reported so the banner can announce it.
  const next = steps.find((s) => s.vertexIdx > idx && s.type !== 'depart') || steps[steps.length - 1] || null;
  const distToStepM = next ? Math.max(0, Math.round(cum[next.vertexIdx] - cum[idx])) : remainM;
  const etaS = model.distanceM > 0 ? Math.round(model.durationS * (remainM / model.distanceM)) : 0;
  return { idx, offM, remainM, etaS, next, distToStepM };
}

// OSRM maneuver -> i18n key parts. The caller renders t(key) and, when the
// step carries a street name, wraps it with t('nav.onto', {turn, name}) -
// a whole-sentence template per language, so word order stays translatable.
const MOD_KEYS = {
  left: 'nav.left',
  right: 'nav.right',
  'slight left': 'nav.slightLeft',
  'slight right': 'nav.slightRight',
  'sharp left': 'nav.sharpLeft',
  'sharp right': 'nav.sharpRight',
  straight: 'nav.straight',
  uturn: 'nav.uturn',
};

export function instructionKey(step) {
  if (!step) return { key: 'nav.straight', name: '' };
  const name = step.name || '';
  const t = step.type || '';
  if (t === 'arrive') return { key: 'nav.arriveStep', name: '' };
  if (t === 'depart') return { key: 'nav.depart', name };
  if (t === 'roundabout' || t === 'rotary' || t === 'roundabout turn' || t === 'exit roundabout' || t === 'exit rotary')
    return { key: 'nav.roundabout', name };
  if (t === 'merge') return { key: 'nav.merge', name };
  if (t === 'on ramp') return { key: 'nav.onRamp', name };
  if (t === 'off ramp') return { key: 'nav.offRamp', name };
  return { key: MOD_KEYS[step.mod] || 'nav.straight', name };
}

// Arrow glyph for the banner - language-free.
export function instructionArrow(step) {
  if (!step) return '↑';
  if (step.type === 'arrive') return '⚑';
  const mod = step.mod || '';
  if (mod.includes('uturn')) return '⤶';
  if (mod === 'sharp left') return '↰';
  if (mod === 'sharp right') return '↱';
  if (mod.includes('left')) return '←';
  if (mod.includes('right')) return '→';
  return '↑';
}
