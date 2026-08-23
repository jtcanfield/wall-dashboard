export interface FeedSource {
    /** Shown in the panel next to the headline. */
    label: string;
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
 * All URLs verified live 2026-08-23.
 *
 * **CNN is gone.** Every CNN RSS endpoint is abandoned — cnn_topstories last
 * published April 2023, cnn_allpolitics June 2024, cnn_world September 2023.
 * Worse than merely empty: the stale entries that still carry dates get
 * dropped by the age cutoff while the *undated* `cnn-underscored` commerce
 * pages sail through it, so the feed actively degrades into nothing but
 * product round-ups. Do not put CNN back without checking freshness first.
 *
 * The replacements are chosen for US and global politics with the least
 * lifestyle content mixed in, and all of them date every item.
 */
export const FEEDS: FeedSource[] = [
    {
        label: "NPR",
        urls: ["https://feeds.npr.org/1014/rss.xml"],
        language: "en",
    },
    {
        label: "PBS",
        urls: ["https://www.pbs.org/newshour/feeds/rss/politics"],
        language: "en",
    },
    {
        label: "BBC",
        urls: ["https://feeds.bbci.co.uk/news/world/rss.xml"],
        language: "en",
    },
    {
        label: "Новая",
        // novayagazeta.ru per decision 2. Note the .eu exile edition publishes in
        // Russian as well, so switching to it would not avoid translation.
        urls: ["https://novayagazeta.ru/feed/rss"],
        language: "ru",
        // Measured 2026-08-23: 100 items in the feed, exactly one inside 24 hours
        // on a Sunday, the next seven all 29h+. At the default cutoff this source
        // is simply absent most of the time.
        maxAgeHours: 48,
    },
];

/** Headlines older than this are dropped. */
export const MAX_AGE_HOURS = 24;
/** Cap on what reaches the client; the panel shows fewer than this. */
export const MAX_ITEMS = 30;
/**
 * Per-source cap applied before merging, so one high-volume feed (BBC World
 * publishes ~38 at a time) cannot crowd out the others.
 */
export const MAX_PER_SOURCE = 8;
