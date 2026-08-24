import type { CacheEntry, NewsItem } from "@shared/types";
import { EXPECTED_INTERVAL_MS, NEWS_VISIBLE } from "@shared/types";
import { Stale } from "../components/stale";
import { newsStamp } from "../time";

interface Props {
    entry: CacheEntry<NewsItem[]>;
}

/**
 * The slot count lives in shared/types.ts because the server selects against
 * it — it balances which sources are represented in exactly this many slots,
 * and slicing a longer list here would discard that balance. The number itself
 * is what fits the right column with every headline wrapped to two lines.
 */
const VISIBLE = NEWS_VISIBLE;

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
