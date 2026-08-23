/**
 * Filler rejection for news feeds.
 *
 * Mainstream outlets mix commerce and lifestyle content into their news feeds:
 * product round-ups, gift guides, affiliate deals, podcast episodes, recipes,
 * horoscopes. On a wall display that is pure noise — the panel has nine slots
 * and every one spent on "42 of the most useful travel products you can buy on
 * Amazon" is a headline not shown.
 *
 * Two independent signals, because either alone leaks:
 *  - the URL path, which is where outlets segregate commerce content
 *    (CNN's `/cnn-underscored/`, Guardian's `/lifeandstyle/`), and
 *  - the headline shape, which catches listicles and gift guides published
 *    under an otherwise ordinary path.
 */

/**
 * Section words that mark a non-news area of a site.
 *
 * Matched against tokens of the first two path segments only — never the
 * article slug. A substring match over the whole path would reject
 * `/news/transport-strike` for containing "sport", and
 * `/politics/trump-deals-with-congress` for containing "deals". The section is
 * where outlets actually segregate this content, so that is where to look.
 */
const FILLER_SECTIONS = new Set([
  'underscored',
  'podcast',
  'podcasts',
  'audio',
  'shopping',
  'deal',
  'deals',
  'coupon',
  'coupons',
  'gift',
  'gifts',
  'review',
  'reviews',
  'recipe',
  'recipes',
  'horoscope',
  'horoscopes',
  'crossword',
  'crosswords',
  'puzzle',
  'puzzles',
  'game',
  'games',
  'lifeandstyle',
  'lifestyle',
  'style',
  'fashion',
  'beauty',
  'wellness',
  'food',
  'drink',
  'travel',
  'sport',
  'sports',
  'entertainment',
  'culture',
  'arts',
]);

/** Tokens of the first two path segments, split on hyphens. */
function sectionTokens(path: string): string[] {
  return path
    .split('/')
    .filter(Boolean)
    .slice(0, 2)
    .flatMap((segment) => segment.toLowerCase().split('-'));
}

/** Headline shapes that mean commerce or listicle rather than reporting. */
const FILLER_TITLE: RegExp[] = [
  /\bpodcast\b/i,
  /^\s*\d+\+?\s+(of\s+)?(the\s+)?(best|most|top|greatest|essential|useful|thoughtful)/i,
  /\b(the\s+)?\d+\s+best\b/i,
  /\bbest\s+.*\b(of|for)\s+(20\d\d|january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b(gift|holiday)\s+guides?\b/i,
  /\bgifts?\s+(she|he|they|mom|dad|kids)\b/i,
  /\b(mother|father)'?s\s+day\b.*\b(gift|around the corner|shop)/i,
  /\b(deal|sale|discount|coupon|lowest price|price ever|prime day|black friday|way day)\b/i,
  /\byou can buy\b/i,
  /\bproducts? to\b/i,
  // First-person advocacy is a reliable commerce tell: news desks report in
  // the third person, product desks write "we tested X and you should too".
  /\bwe (tested|tried|stopped|started|switched|swear by)\b/i,
  /\byou should too\b/i,
  /\bshop (now|these|the)\b/i,
  /\bhere'?s how to (file|compost|clean|organi[sz]e|save)\b/i,
  /\bhoroscope\b/i,
  /\brecipe\b/i,
  /\bwordle\b/i,
];

export interface FilterableItem {
  title: string;
  link: string;
  publishedAt: string | null;
}

export type RejectionReason = 'undated' | 'filler-path' | 'filler-title';

export function rejectionReason(item: FilterableItem): RejectionReason | null {
  // Undated first. Real reporting is always dated; evergreen commerce pages
  // usually are not, which is why they survive an age cutoff that drops
  // everything else. This one check removes most filler on its own.
  if (!item.publishedAt) return 'undated';

  let path = item.link;
  try {
    path = new URL(item.link).pathname;
  } catch {
    // Not a parseable URL — fall through and tokenise the raw string.
  }
  if (sectionTokens(path).some((token) => FILLER_SECTIONS.has(token))) return 'filler-path';

  if (FILLER_TITLE.some((re) => re.test(item.title))) return 'filler-title';

  return null;
}

export const isNews = (item: FilterableItem): boolean => rejectionReason(item) === null;
