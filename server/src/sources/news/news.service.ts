import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import Parser from 'rss-parser';
import { CacheService } from '../../cache/cache.service';
import { NewsItem } from '../../shared';
import { FEEDS, FeedSource, MAX_AGE_HOURS, MAX_ITEMS } from './feeds';
import { stagger } from '../stagger';

/**
 * Parsed server-side because RSS feeds don't send CORS headers — the browser
 * physically cannot fetch them. Headline, source and timestamp only: article
 * bodies aren't ours to republish and there's no room for them anyway.
 */
@Injectable()
export class NewsService implements OnModuleInit {
  private readonly log = new Logger(NewsService.name);
  private readonly parser = new Parser({ timeout: 10_000 });
  /** Remembers which candidate URL worked, so we stop retrying dead ones. */
  private readonly resolved = new Map<string, string>();

  constructor(private readonly cache: CacheService) {}

  onModuleInit(): void {
    stagger('news', () => this.refresh());
  }

  @Interval('news', 10 * 60_000)
  async refresh(): Promise<void> {
    await this.cache.refresh('news', () => this.fetchAll());
  }

  private async fetchAll(): Promise<NewsItem[]> {
    const results = await Promise.allSettled(FEEDS.map((f) => this.fetchFeed(f)));

    const items: NewsItem[] = [];
    let failures = 0;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        items.push(...r.value);
      } else {
        failures++;
        this.log.warn(`Feed ${FEEDS[i]?.label} failed — ${String(r.reason)}`);
      }
    });

    // Only a total wipeout is an error; one dead feed still leaves a usable panel.
    if (items.length === 0) throw new Error(`all ${failures} feeds failed`);

    const cutoff = DateTime.now().minus({ hours: MAX_AGE_HOURS });
    return items
      .filter((i) => !i.publishedAt || DateTime.fromISO(i.publishedAt) > cutoff)
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
      .slice(0, MAX_ITEMS);
  }

  private async fetchFeed(feed: FeedSource): Promise<NewsItem[]> {
    const known = this.resolved.get(feed.label);
    const candidates = known ? [known, ...feed.urls.filter((u) => u !== known)] : feed.urls;

    let lastError: unknown;
    for (const url of candidates) {
      try {
        const parsed = await this.parser.parseURL(url);
        this.resolved.set(feed.label, url);
        return (parsed.items ?? []).flatMap((item): NewsItem[] => {
          const title = item.title?.trim();
          const link = item.link?.trim();
          if (!title || !link) return [];
          const published = item.isoDate ?? item.pubDate;
          return [
            {
              id: item.guid ?? link,
              title,
              link,
              source: feed.label,
              publishedAt: published ? DateTime.fromISO(published).toISO() : null,
            },
          ];
        });
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
