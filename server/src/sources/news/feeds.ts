export interface FeedSource {
  /** Shown in the panel next to the headline. */
  label: string;
  /**
   * Tried in order. Publishers move their feed paths around and there is no
   * one to notice on an unattended display, so each source gets candidates.
   */
  urls: string[];
}

/**
 * Decision 2 chose novayagazeta.ru — the original outlet — over the .eu exile
 * publication.
 */
export const FEEDS: FeedSource[] = [
  {
    label: 'CNN',
    // Verified 2026-08-23: rss.cnn.com serves this over http only — the https
    // URL fails at the TLS layer. The https form stays as a candidate in case
    // that is ever fixed. Plaintext is acceptable for a LAN-only display
    // fetching public headlines.
    urls: ['http://rss.cnn.com/rss/cnn_topstories.rss', 'https://rss.cnn.com/rss/cnn_topstories.rss'],
  },
  {
    label: 'Новая газета',
    // Verified 2026-08-23: /feed/rss is the live path. /contents/rss,
    // /rss/all.xml and /rss all 404.
    urls: ['https://novayagazeta.ru/feed/rss'],
  },
];

/** Headlines older than this are dropped. */
export const MAX_AGE_HOURS = 24;
/** Cap on what reaches the client; the panel shows fewer than this. */
export const MAX_ITEMS = 30;
