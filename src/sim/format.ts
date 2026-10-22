/** Money in New Taiwan dollars, as the game shows it. */
export function ntd(v: number): string {
  return `${v < 0 ? '−' : ''}NT$${Math.abs(Math.round(v)).toLocaleString()}`;
}

/** The day the game calendar starts on. */
export const START_DATE = Date.UTC(2026, 0, 1);
const DAY_MS = 86400000;

/** Calendar date and time for a point in game days (fraction = time of day): 2026/01/01 08:30:00. */
export function gameDate(days: number, withTime = true): string {
  const d = new Date(START_DATE + Math.max(0, days) * DAY_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}`;
  return withTime ? `${date} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` : date;
}
