import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { DateTime } from "luxon";
import Parser from "rss-parser";
import { CacheService } from "../../cache/cache.service";
import { NEWS_COUNT, NewsItem } from "../../shared";
import { FEEDS, FeedSource, MAX_AGE_HOURS, MAX_PER_SOURCE, REGION_MINIMUMS, Region } from "./feeds";
import { RejectionReason, rejectionReason } from "./filter";
import { TranslateService } from "./translate.service";
import { stagger } from "../stagger";

/**
 * Parsed server-side because RSS feeds don't send CORS headers — the browser
 * physically cannot fetch them. Headline, source and timestamp only: article
 * bodies aren't ours to republish and there's no room for them anyway.
 */
@Injectable()
export class NewsService implements OnModuleInit {
    private readonly log = new Logger(NewsService.name);
    private readonly parser = new Parser({ timeout: 12_000 });
    /** Remembers which candidate URL worked, so we stop retrying dead ones. */
    private readonly resolved = new Map<string, string>();

    constructor(
        private readonly cache: CacheService,
        private readonly translate: TranslateService,
    ) {}

    onModuleInit(): void {
        stagger("news", () => this.refresh());
    }

    @Interval("news", 10 * 60_000)
    async refresh(): Promise<void> {
        await this.cache.refresh("news", () => this.fetchAll());
    }

    private async fetchAll(): Promise<NewsItem[]> {
        const results = await Promise.allSettled(FEEDS.map((f) => this.fetchFeed(f)));

        const items: NewsItem[] = [];
        let failures = 0;
        results.forEach((r, i) => {
            if (r.status === "fulfilled") {
                items.push(...r.value);
            } else {
                failures++;
                this.log.warn(`Feed ${FEEDS[i]?.label} failed — ${String(r.reason)}`);
            }
        });

        // Only a total wipeout is an error; one dead feed still leaves a usable panel.
        if (items.length === 0) {
            throw new Error(`all ${failures} feeds produced nothing`);
        }

        return selectVisible(items, NEWS_COUNT);
    }

    private async fetchFeed(feed: FeedSource): Promise<NewsItem[]> {
        const known = this.resolved.get(feed.label);
        const candidates = known ? [known, ...feed.urls.filter((u) => u !== known)] : feed.urls;

        let lastError: unknown;
        for (const url of candidates) {
            try {
                const parsed = await this.parser.parseURL(url);
                this.resolved.set(feed.label, url);
                return await this.toItems(feed, parsed.items ?? []);
            } catch (err) {
                lastError = err;
            }
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    private async toItems(feed: FeedSource, raw: Parser.Item[]): Promise<NewsItem[]> {
        const cutoff = DateTime.now().minus({ hours: feed.maxAgeHours ?? MAX_AGE_HOURS });
        const rejected = new Map<RejectionReason, number>();

        const kept = raw
            .flatMap((item) => {
                const title = item.title?.trim();
                const link = item.link?.trim();
                if (!title || !link) {
                    return [];
                }

                const raw = item.isoDate ?? item.pubDate;
                const parsed = raw
                    ? DateTime.fromISO(
                          DateTime.fromRFC2822(raw).isValid
                              ? DateTime.fromRFC2822(raw).toISO()!
                              : raw,
                      )
                    : null;
                const publishedAt = parsed?.isValid ? parsed.toISO() : null;

                const reason = rejectionReason({ title, link, publishedAt });
                if (reason) {
                    rejected.set(reason, (rejected.get(reason) ?? 0) + 1);
                    return [];
                }
                // rejectionReason guarantees publishedAt is non-null past this point.
                return [
                    {
                        id: item.guid ?? link,
                        title,
                        link,
                        source: feed.label,
                        publishedAt: publishedAt!,
                    },
                ];
            })
            .filter((i) => DateTime.fromISO(i.publishedAt) > cutoff)
            .sort((a, b) => publishedMillis(b) - publishedMillis(a))
            .slice(0, MAX_PER_SOURCE);

        if (rejected.size > 0) {
            const summary = [...rejected].map(([r, n]) => `${n} ${r}`).join(", ");
            this.log.log(`${feed.label}: kept ${kept.length}, dropped ${summary}`);
        }

        if (feed.language === "en" || kept.length === 0) {
            return kept;
        }

        // Translate only after filtering and capping, so the character budget is
        // never spent on headlines that were never going to be displayed.
        const translations = await this.translate.translateAll(
            kept.map((i) => i.title),
            feed.language,
        );
        return kept.map((item, i) => {
            const translated = translations[i];
            return translated && translated !== item.title
                ? { ...item, title: translated, titleOriginal: item.title }
                : item;
        });
    }
}

/** Source label -> region, built once from the feed table. */
const REGION_BY_SOURCE = new Map<string, Region>(FEEDS.map((f) => [f.label, f.region]));

/**
 * Picks the headlines the panel will show.
 *
 * Two passes, and the split between them is the whole point:
 *
 * 1. **Membership** — each region takes its own newest items up to its floor in
 *    REGION_MINIMUMS, so a low-volume source cannot be crowded out entirely by
 *    thirteen feeds competing for sixteen slots. The remaining slots go to
 *    whatever is newest, regardless of region.
 * 2. **Order** — the chosen set is then rendered strictly newest-first.
 *
 * So a reserved 17-hour-old headline from Новая appears near the bottom of the
 * panel, never at the top. Position still means "how recent". This is what
 * separates it from the round-robin interleave that was tried and deliberately
 * reverted: nothing here lets a source jump the queue.
 */
export function selectVisible(items: NewsItem[], limit: number): NewsItem[] {
    // Compared as instants rather than as ISO strings: two feeds can
    // legitimately report the same moment with different UTC offsets, and a
    // lexical compare would then order them by the offset, not by the time.
    const byRecency = [...items].sort((a, b) => publishedMillis(b) - publishedMillis(a));
    const chosen = new Set<NewsItem>();

    for (const [region, floor] of Object.entries(REGION_MINIMUMS) as [Region, number][]) {
        let taken = 0;
        for (const item of byRecency) {
            if (taken >= floor || chosen.size >= limit) {
                break;
            }
            if (chosen.has(item) || REGION_BY_SOURCE.get(item.source) !== region) {
                continue;
            }
            chosen.add(item);
            taken++;
        }
    }

    for (const item of byRecency) {
        if (chosen.size >= limit) {
            break;
        }
        chosen.add(item);
    }

    return byRecency.filter((item) => chosen.has(item));
}

/**
 * Publish instant, for ordering.
 *
 * The feed panel is sorted strictly newest-first across every source. An
 * earlier version round-robined the sources so each stayed visible, because
 * BBC World publishes several times an hour and was taking six of the nine
 * slots. That was reverted deliberately: on a wall display the top line should
 * be the newest thing that has happened, not the newest thing from whichever
 * source is due a turn. MAX_PER_SOURCE still caps how much any one feed can
 * contribute to the pool, which is the only balancing left.
 */
function publishedMillis(item: NewsItem): number {
    const at = DateTime.fromISO(item.publishedAt);
    return at.isValid ? at.toMillis() : 0;
}
