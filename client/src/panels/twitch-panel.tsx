import type { CacheEntry, TwitchStream } from '@shared/types';

interface Props {
  entry: CacheEntry<TwitchStream[]>;
}

const uptime = (startedAt: string): string => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 60_000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

/**
 * Offline streamers are absent from the Helix response, so an empty array is
 * the offline signal. When nobody is live the panel renders nothing at all and
 * gives its height back to the news feed above it.
 *
 * Placement is still an open decision — this sits bottom-right for now.
 */
export function TwitchPanel({ entry }: Props) {
  const live = entry.data ?? [];
  if (live.length === 0) return null;

  return (
    <section class="panel">
      <header class="panel__head">
        <span class="panel__title">Live</span>
      </header>
      <div class="panel__body twitch">
        {live.slice(0, 2).map((s) => (
          <div class="twitch__stream" key={s.userLogin}>
            <img class="twitch__thumb" src={s.thumbnailUrl} alt="" />
            <div>
              <div class="twitch__name">
                <i class="twitch__dot" />
                {s.userName}
              </div>
              <div class="twitch__title">{s.title}</div>
              <div class="twitch__meta">
                {s.gameName || 'Streaming'} · {s.viewerCount.toLocaleString()} · {uptime(s.startedAt)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
