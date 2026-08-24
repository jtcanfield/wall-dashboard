/** Coarse geography, used only to guarantee each region a floor of slots. */
export type Region = "us" | "eu" | "ru";

export interface FeedSource {
    /** Shown in the panel next to the headline. */
    label: string;
    /** Which regional floor this feed counts towards. */
    region: Region;
    /**
     * Tried in order. Publishers move their feed paths around and there is no
     * one to notice on an unattended display, so each source gets candidates.
     */
    urls: string[];
    /** Source language. Anything not 'en' gets machine translated. */
    language: "en" | "ru";
    /**
     * Overrides MAX_AGE_HOURS. Low-volume publishers need a longer window or
     * they vanish from the panel entirely on a quiet day, which reads as a
     * broken feed rather than a slow news day.
     */
    maxAgeHours?: number;
}

/**
 * All URLs verified live 2026-08-24: fetched, item count counted, newest
 * pubDate read. Anything not listed here failed that check.
 *
 * **CNN is gone.** Every CNN RSS endpoint is abandoned — cnn_topstories last
 * published April 2023, cnn_allpolitics June 2024, cnn_world September 2023.
 * Worse than merely empty: the stale entries that still carry dates get
 * dropped by the age cutoff while the *undated* `cnn-underscored` commerce
 * pages sail through it, so the feed actively degrades into nothing but
 * product round-ups. Do not put CNN back without checking freshness first.
 *
 * **Also measured dead, do not retry without re-checking:** AP
 * (`apnews.com/index.rss`) returns 401, Reuters (`feeds.reuters.com`) no
 * longer resolves, Euractiv returns 403 to any non-browser client, and
 * Politico's `politics-news.xml` was ~40 hours stale on a Sunday night.
 *
 * **Meduza's English edition is the stale one.** `meduza.io/rss/en/all` was
 * three days behind while `meduza.io/rss/all` was current to the hour, so the
 * Russian feed goes through the translation pipeline instead. This is the
 * opposite of the usual assumption and cost a probe to notice.
 *
 * The set is weighted US-first, then EU, then Russia, per the owner's reading
 * priorities.
 */
export const FEEDS: FeedSource[] = [
    /* ---------------------------------------------------------------- US */
    {
        label: "NPR",
        region: "us",
        urls: ["https://feeds.npr.org/1014/rss.xml"],
        language: "en",
    },
    {
        label: "PBS",
        region: "us",
        urls: ["https://www.pbs.org/newshour/feeds/rss/politics"],
        language: "en",
    },
    {
        label: "NYT",
        region: "us",
        urls: ["https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml"],
        language: "en",
    },
    {
        label: "The Hill",
        region: "us",
        urls: ["https://thehill.com/rss/syndicator/19110"],
        language: "en",
    },
    {
        label: "Guardian",
        region: "us",
        // The US-politics section feed, not the world firehose — Guardian world
        // already overlaps BBC heavily and this is the half BBC does not cover.
        urls: [
            "https://www.theguardian.com/us-news/us-politics/rss",
            "https://www.theguardian.com/world/rss",
        ],
        language: "en",
    },

    /* ------------------------------------------------------ EU / global */
    {
        label: "BBC",
        region: "eu",
        urls: ["https://feeds.bbci.co.uk/news/world/rss.xml"],
        language: "en",
    },
    {
        label: "DW",
        region: "eu",
        // Highest volume in the set by a wide margin (130 items in one pull),
        // which is exactly what MAX_PER_SOURCE exists to contain.
        urls: ["https://rss.dw.com/xml/rss-en-eu", "https://rss.dw.com/rdf/rss-en-all"],
        language: "en",
    },
    {
        label: "France 24",
        region: "eu",
        urls: ["https://www.france24.com/en/rss"],
        language: "en",
    },
    {
        label: "Euronews",
        region: "eu",
        // Serves gzip unconditionally. rss-parser decompresses it, but a raw
        // curl probe without --compressed gets a body full of null bytes and
        // counts zero items — so this feed looks dead when hand-checked and is
        // perfectly healthy in the app. Verified through the parser: 50 items.
        urls: ["https://www.euronews.com/rss?level=theme&name=news"],
        language: "en",
    },
    {
        label: "Al Jazeera",
        region: "eu",
        urls: ["https://www.aljazeera.com/xml/rss/all.xml"],
        language: "en",
    },

    /* ------------------------------------------------------------ Russia */
    {
        label: "Новая",
        region: "ru",
        // novayagazeta.ru per decision 2. Note the .eu exile edition publishes in
        // Russian as well, so switching to it would not avoid translation.
        urls: ["https://novayagazeta.ru/feed/rss"],
        language: "ru",
        // Measured 2026-08-23: 100 items in the feed, exactly one inside 24 hours
        // on a Sunday, the next seven all 29h+. At the default cutoff this source
        // is simply absent most of the time.
        maxAgeHours: 48,
    },
    {
        label: "Meduza",
        region: "ru",
        urls: ["https://meduza.io/rss/all"],
        language: "ru",
    },
    {
        label: "Moscow Times",
        region: "ru",
        urls: ["https://www.themoscowtimes.com/rss/news"],
        language: "en",
    },
];

/** Headlines older than this are dropped. */
export const MAX_AGE_HOURS = 24;
/**
 * Floor of slots guaranteed to each region, out of NEWS_VISIBLE.
 *
 * These affect **membership only, never order** — the selected set is still
 * rendered strictly newest-first, so the top line is still the newest thing
 * that has happened. That is the distinction from the round-robin interleave
 * that was tried and reverted: this does not let a source jump the queue, it
 * only stops a source being crowded out of the panel entirely.
 *
 * Needed because thirteen sources compete for sixteen slots. Новая publishes a
 * few times a day and its newest item was 17.8h old when measured, so under an
 * unreserved sort the one source with an entire translation pipeline behind it
 * would essentially never appear. US gets no floor: it dominates on recency
 * anyway and reserving for it would do nothing.
 *
 * Must sum to well under NEWS_VISIBLE, or the floors become the whole panel.
 */
export const REGION_MINIMUMS: Record<Region, number> = {
    us: 0,
    eu: 3,
    ru: 2,
};
/**
 * Per-source cap applied before merging, so one high-volume feed cannot crowd
 * out the others.
 *
 * Dropped from 8 to 3 when the set grew from four sources to thirteen. Under a
 * strict newest-first sort the cap is the *only* balancing mechanism there is,
 * so it has to scale down as sources are added or DW and the Guardian simply
 * take the whole panel between them.
 */
export const MAX_PER_SOURCE = 3;
