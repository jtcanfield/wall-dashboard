import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { CacheEntry, NewsItem } from "@shared/types";
import { EXPECTED_INTERVAL_MS, NEWS_COUNT } from "@shared/types";
import { Stale } from "../components/stale";
import { newsStamp } from "../time";

interface Props {
    entry: CacheEntry<NewsItem[]>;
}

/**
 * Scroll speed. Slow enough to read a two-line headline without hurrying,
 * which at this type size is around a second per line.
 *
 * Forty headlines is roughly 2,000px of track, so a full cycle takes a little
 * over two minutes. Nothing on this display needs to be caught on a first
 * pass — it comes back around.
 */
const PX_PER_SECOND = 14;

function Item({ item }: { item: NewsItem }) {
    return (
        <article class="news__item">
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
    );
}

/**
 * One pass of the list, headed by the loop marker.
 *
 * The marker sits *inside* the copy rather than above the track, so it travels
 * with the headlines and comes back around with them. That is the whole point
 * of it: without a mark, a seamless loop is indistinguishable from an endless
 * feed, and you cannot tell whether you are reading something new or something
 * you already read two minutes ago.
 */
function Copy({ items, echo }: { items: NewsItem[]; echo?: boolean }) {
    return (
        <div class="news__copy" aria-hidden={echo ? "true" : undefined}>
            <div class="news__marker">
                <span class="news__marker-label">Latest</span>
                <span class="news__marker-rule" />
            </div>
            {items.map((item) => (
                <Item item={item} key={echo ? `echo-${item.id}` : item.id} />
            ))}
        </div>
    );
}

/**
 * The feed scrolls continuously rather than paging, because a page flip on a
 * wall display steals attention at a moment you did not choose — you look up
 * because something moved, not because you wanted to read. A slow crawl is
 * ignorable until you decide to read it.
 *
 * The track holds the list twice and translates by exactly one copy's height,
 * so the loop is seamless: the moment the first copy leaves, the second is
 * already in its place. This is why every child carries `margin-bottom`
 * instead of the container carrying `gap` — gap puts a seam between the two
 * copies that has to be added back into the distance by hand, and any drift
 * there shows up as a visible jump once a cycle.
 */
export function NewsPanel({ entry }: Props) {
    const items = (entry.data ?? []).slice(0, NEWS_COUNT);
    const viewport = useRef<HTMLDivElement>(null);
    const track = useRef<HTMLDivElement>(null);
    const [distance, setDistance] = useState(0);

    // Identity of the array changes on every SSE frame; the ids are what
    // actually decide the track height, so they are the dependency.
    const signature = items.map((i) => i.id).join("|");

    useLayoutEffect(() => {
        const box = viewport.current;
        const rail = track.current;
        if (!box || !rail) {
            return;
        }

        const measure = (): void => {
            const copy = rail.scrollHeight / 2;
            // Nothing to scroll if the list already fits — which is what
            // happens when the feed is cold or a Twitch player has taken the
            // column.
            setDistance(copy > box.clientHeight ? copy : 0);
        };
        measure();

        // The headline ids are not the only thing that changes this height. A
        // late webfont, a stylesheet edit, or the Twitch player appearing and
        // shrinking the column all resize the track while the ids stay put,
        // and a stale distance means the loop no longer lands where the track
        // repeats — it drifts by that error every single cycle. Observing the
        // element is the only measurement that cannot go stale.
        const observer = new ResizeObserver(measure);
        observer.observe(rail);
        observer.observe(box);
        return () => {
            observer.disconnect();
        };
    }, [signature]);

    const seconds = distance / PX_PER_SECOND;

    return (
        <section class="panel">
            <header class="panel__head">
                <span class="panel__title">News</span>
                <Stale entry={entry} expectedMs={EXPECTED_INTERVAL_MS.news} />
            </header>
            {/* Counts down to the moment "Latest" is back at the top. Shares the
                scroll's duration and mounts in the same commit, so the two stay
                in phase without any coordination: the track is at translateY(0)
                exactly when this is empty, and both take a duration change
                identically if a new headline resizes the track. */}
            {distance > 0 && (
                <span class="news__progress" style={{ animationDuration: `${seconds}s` }} />
            )}
            <div class={`panel__body news${distance > 0 ? " news--scrolling" : ""}`} ref={viewport}>
                {items.length === 0 ? (
                    <span class="empty">No headlines yet</span>
                ) : (
                    <div
                        class="news__track"
                        ref={track}
                        style={{
                            "--news-distance": `${distance}px`,
                            animationDuration: distance > 0 ? `${seconds}s` : undefined,
                        }}
                    >
                        <Copy items={items} />
                        {/* The second copy is what makes the wrap seamless. It is
                            decoration, so it is hidden from assistive tech. */}
                        <Copy items={items} echo />
                    </div>
                )}
            </div>
        </section>
    );
}
