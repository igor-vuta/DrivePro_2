// Daily streaks: consecutive calendar days (server-local time) with at least
// one finished shared ride, in either seat. The flame multiplies points.

export const STREAK_TIERS = [
  [30, 2],
  [14, 1.75],
  [7, 1.5],
  [3, 1.25],
];

export function streakMultiplier(days) {
  for (const [d, m] of STREAK_TIERS) {
    if (days >= d) return m;
  }
  return 1;
}

// 'YYYY-MM-DD' in server-local time.
export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function prevDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1).getTime());
}

export function startOfDay(ts = Date.now()) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
