import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { DateTime } from "luxon";
import Parser from "rss-parser";
import { CacheService } from "../../cache/cache.service";
import { NewsItem } from "../../shared";
import { FEEDS, FeedSource, MAX_AGE_HOURS, MAX_ITEMS, MAX_PER_SOURCE } from "./feeds";
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

        return interleaveBySource(items).slice(0, MAX_ITEMS);
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
            .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
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

/**
 * Round-robin the sources instead of sorting the merged list by recency.
 *
 * Straight recency ordering is wrong for this panel. BBC World publishes far
 * more often than the others, so it took six of the nine visible slots and the
 * Russian source — the one with a whole translation pipeline behind it — never
 * appeared at all. Nine slots out of ~22 candidates makes breadth worth more
 * than strict ordering.
 *
 * Queues are seeded in order of their freshest item, so the top slot is still
 * the newest headline overall; only the slots below it are shared out.
 */
function interleaveBySource(items: NewsItem[]): NewsItem[] {
    const bySource = new Map<string, NewsItem[]>();
    for (const item of items) {
        const queue = bySource.get(item.source);
        if (queue) {
            queue.push(item);
        } else {
            bySource.set(item.source, [item]);
        }
    }

    for (const queue of bySource.values()) {
        queue.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    }

    const queues = [...bySource.values()].sort((a, b) =>
        (b[0]?.publishedAt ?? "").localeCompare(a[0]?.publishedAt ?? ""),
    );

    const out: NewsItem[] = [];
    for (let round = 0; out.length < items.length; round++) {
        let addedAny = false;
        for (const queue of queues) {
            const item = queue[round];
            if (item) {
                out.push(item);
                addedAny = true;
            }
        }
        if (!addedAny) {
            break;
        }
    }
    return out;
}
