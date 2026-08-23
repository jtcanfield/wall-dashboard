import { DateTime } from 'luxon';

/** "2026-08-23T14:40" (local wall clock, no offset) -> "2:40 PM". */
export const clockTime = (localIso: string): string =>
  DateTime.fromISO(localIso).toFormat('h:mm a');

export const localMillis = (localIso: string): number => DateTime.fromISO(localIso).toMillis();

/** Compact relative age for headlines and staleness: "4m", "2h", "3d". */
export function shortAgo(iso: string): string {
  const diff = DateTime.now().diff(DateTime.fromISO(iso));
  const minutes = Math.max(0, Math.round(diff.as('minutes')));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(diff.as('hours'));
  if (hours < 48) return `${hours}h`;
  return `${Math.round(diff.as('days'))}d`;
}
