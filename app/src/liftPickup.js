// Name the same pickup point the server will accept. Copy it before the
// asynchronous lookup so later GPS fixes cannot change the displayed place.
export async function resolveLiftPickup({ meet, walkerPosition, reverseLookup }) {
  const source = meet || walkerPosition;
  if (!source || !Number.isFinite(source.lat) || !Number.isFinite(source.lng)) return null;
  const point = { lat: source.lat, lng: source.lng };
  const fallback = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
  try {
    const name = await reverseLookup(point);
    if (typeof name === 'string' && name.trim()) return { point, address: name.trim() };
  } catch (e) {}
  return { point, address: fallback };
}
