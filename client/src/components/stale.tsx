import type { CacheEntry } from '@shared/types';
import { shortAgo } from '../time';

interface Props {
  entry: CacheEntry<unknown>;
  /** How old the entry may get before it is worth pointing out, in ms. */
  expectedMs: number;
}

/**
 * A subtle age indicator, shown only once an entry is older than its own poll
 * interval. A failed refresh never clears data, so a panel can legitimately be
 * showing yesterday's numbers — this is the only hint that it is.
 */
export function Stale({ entry, expectedMs }: Props) {
  if (!entry.fetchedAt) return entry.error ? <span class="stale stale--error">no data</span> : null;

  const age = Date.now() - Date.parse(entry.fetchedAt);
  if (age < expectedMs * 1.5 && !entry.error) return null;

  return (
    <span class={`stale${entry.error ? ' stale--error' : ''}`}>{shortAgo(entry.fetchedAt)} old</span>
  );
}
