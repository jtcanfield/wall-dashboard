import type { CacheEntry, NewsItem } from "@shared/types";
import { EXPECTED_INTERVAL_MS } from "@shared/types";
import { Stale } from "../components/stale";
import { newsStamp } from "../time";

interface Props {
    entry: CacheEntry<NewsItem[]>;
}

/**
 * What fits in the right column without the last item being clipped.
 *
 * Raised from 9 when the feed set grew from four sources to thirteen: at nine
 * slots the extra sources changed which nine headlines appeared but not how
 * much was on screen, which is not what more sources were for. Sized against
 * the worst case of every headline wrapping to two lines.
 */
const VISIBLE = 16;

export function NewsPanel({ entry }: Props) {
    const items = (entry.data ?? []).slice(0, VISIBLE);

    return (
        <section class="panel">
            <header class="panel__head">
                <span class="panel__title">News</span>
                <Stale entry={entry} expectedMs={EXPECTED_INTERVAL_MS.news} />
            </header>
            <div class="panel__body news">
                {items.length === 0 ? (
                    <span class="empty">No headlines yet</span>
                ) : (
                    items.map((item) => (
                        <article class="news__item" key={item.id}>
                            {/* Headline, source and time only — no article bodies. */}
                            <span class="news__title">
                                {item.title}
                                {/* Machine translated; the marker keeps that honest. */}
                                {item.titleOriginal && (
                                    <i class="news__translated" title={item.titleOriginal}>
                                        RU
                                    </i>
                                )}
                            </span>
                            <span class="news__meta">
                                {item.source}
                                <span class="news__time">{newsStamp(item.publishedAt)}</span>
                            </span>
                        </article>
                    ))
                )}
            </div>
        </section>
    );
}
