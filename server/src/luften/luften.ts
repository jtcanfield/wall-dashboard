import { LuftenDay, LuftenKind, LuftenWindow, WeatherHour } from '../shared';

/** Outdoor dewpoint must be at least this far below indoor to actually dry. */
export const DEWPOINT_MARGIN_F = 5;
/** Less than this much precipitation over the hour counts as dry. */
const DRY_THRESHOLD_IN = 0.005;

/** Stoßlüften: a 5–10 minute burst. Outdoor temp barely matters at that length. */
const EXCHANGE_TEMP_F = { min: 40, max: 80 } as const;
/** Windows open all day — this is the comfort band, not a drying constraint. */
const ALL_DAY_TEMP_F = { min: 67, max: 75 } as const;

/**
 * A condition expressed as a margin: satisfied when >= 0. Keeping these
 * continuous is what lets us interpolate band-crossing times and report
 * "10:40–13:20" instead of "11:00–13:00".
 *
 * Precipitation is deliberately not one of them — see `isWet`.
 */
type Constraint = (h: WeatherHour) => number;

function constraintsFor(kind: LuftenKind, indoorDewPointF: number): Constraint[] {
  const band = kind === 'all-day' ? ALL_DAY_TEMP_F : EXCHANGE_TEMP_F;
  return [
    (h) => indoorDewPointF - DEWPOINT_MARGIN_F - h.dewPointF,
    (h) => h.temperatureF - band.min,
    (h) => band.max - h.temperatureF,
  ];
}

const satisfied = (cs: Constraint[], h: WeatherHour): boolean => cs.every((c) => c(h) >= 0);

/**
 * Whether the hour *ending* at sample `i` was wet.
 *
 * Open-Meteo reports hourly precipitation as a preceding-hour sum, so it is an
 * interval quantity, not a point sample — interpolating it would put the end
 * of a window a couple of minutes *into* the rain. Treating it as the interval
 * it actually describes closes the window on the hour instead.
 */
const isWet = (hourly: WeatherHour[], i: number): boolean =>
  (hourly[i]?.precipitationIn ?? 0) >= DRY_THRESHOLD_IN;

/**
 * Fraction of the way from `a` to `b` at which every constraint is satisfied
 * (entering) or at which the first one fails (leaving).
 *
 * Each margin is linear between two hourly samples, so entering happens when
 * the *last* failing constraint comes good, and leaving when the *first* one
 * goes bad.
 */
function crossing(cs: Constraint[], a: WeatherHour, b: WeatherHour, direction: 'enter' | 'leave'): number {
  const fractions: number[] = [];
  for (const c of cs) {
    const ma = c(a);
    const mb = c(b);
    if (direction === 'enter' ? ma >= 0 : mb >= 0) continue;
    // ma and mb straddle zero here; guard the degenerate flat case.
    const span = mb - ma;
    fractions.push(span === 0 ? 0 : Math.min(Math.max(-ma / span, 0), 1));
  }
  if (fractions.length === 0) return direction === 'enter' ? 0 : 1;
  return direction === 'enter' ? Math.max(...fractions) : Math.min(...fractions);
}

/** "2026-08-23T14:00" + 0.667 of an hour -> "2026-08-23T14:40". */
function interpolateTime(a: string, b: string, fraction: number): string {
  const start = new Date(`${a}:00`).getTime();
  const end = new Date(`${b}:00`).getTime();
  const at = new Date(start + (end - start) * fraction);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}

/**
 * Scan the hourly series for contiguous runs where every condition holds,
 * interpolating the entry and exit times.
 *
 * `hourly[].time` is local wall clock with no offset — Open-Meteo is asked for
 * timezone=America/New_York so the API does the DST math. The Date arithmetic
 * above therefore runs in the server's pinned local zone and stays consistent.
 */
export function findWindows(
  hourly: WeatherHour[],
  kind: LuftenKind,
  indoorDewPointF: number,
): LuftenWindow[] {
  const cs = constraintsFor(kind, indoorDewPointF);
  const windows: LuftenWindow[] = [];
  let openedAt: string | null = null;

  for (let i = 0; i < hourly.length; i++) {
    const hour = hourly[i]!;
    const wet = isWet(hourly, i);
    const isOpen = !wet && satisfied(cs, hour);

    if (isOpen && openedAt === null) {
      const prev = hourly[i - 1];
      // The interval leading into a dry sample is dry by definition, so the
      // continuous constraints can be interpolated across it freely.
      openedAt = prev
        ? interpolateTime(prev.time, hour.time, crossing(cs, prev, hour, 'enter'))
        : hour.time;
    } else if (!isOpen && openedAt !== null) {
      const prev = hourly[i - 1]!;
      const end = wet
        ? prev.time // it rained during this interval; the window ended on the hour
        : interpolateTime(prev.time, hour.time, crossing(cs, prev, hour, 'leave'));
      if (end > openedAt) windows.push({ start: openedAt, end, kind });
      openedAt = null;
    }
  }

  if (openedAt !== null) {
    const last = hourly[hourly.length - 1];
    if (last && last.time > openedAt) windows.push({ start: openedAt, end: last.time, kind });
  }

  return windows;
}

const dateOf = (localIso: string): string => localIso.slice(0, 10);

/**
 * Group both signals by local date. All-day windows are a strict subset of
 * exchange windows (67–75°F sits inside 40–80°F), so a day can legitimately
 * carry both and the UI draws the all-day band on top.
 */
export function buildDays(hourly: WeatherHour[], indoorDewPointF: number): LuftenDay[] {
  const all = [
    ...findWindows(hourly, 'exchange', indoorDewPointF),
    ...findWindows(hourly, 'all-day', indoorDewPointF),
  ];

  const dates = [...new Set(hourly.map((h) => dateOf(h.time)))].sort();
  return dates.map((date) => ({
    date,
    windows: all.filter((w) => dateOf(w.start) === date).sort((a, b) => a.start.localeCompare(b.start)),
  }));
}
