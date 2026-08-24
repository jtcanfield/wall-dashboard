import { DateTime } from "luxon";
import { NewsItem } from "../shared";

/**
 * How far back a cluster may reach. Long enough that a story breaking at
 * :05 and picked up at :50 still counts as one event; short enough that a
 * running topic covered all day does not.
 */
const WINDOW_MINUTES = 90;
/** Distinct sources that must converge before it counts as breaking. */
const MIN_SOURCES = 3;
/** Significant tokens two headlines must share to be about the same thing. */
const MIN_SHARED = 2;

/**
 * Words that carry no topic. Deliberately short: the length floor below
 * removes most function words already, and an aggressive list starts eating
 * the nouns that make a cluster ("house", "state", "court").
 */
const STOPWORDS = new Set([
    "after",
    "about",
    "among",
    "against",
    "amid",
    "been",
    "before",
    "being",
    "could",
    "does",
    "during",
    "from",
    "have",
    "into",
    "more",
    "most",
    "over",
    "said",
    "says",
    "should",
    "than",
    "that",
    "their",
    "them",
    "there",
    "these",
    "they",
    "this",
    "those",
    "through",
    "under",
    "until",
    "what",
    "when",
    "where",
    "which",
    "while",
    "will",
    "with",
    "would",
    "your",
]);

/**
 * Topic tokens for a headline.
 *
 * Unicode-aware because Новая and Meduza fail translation open, leaving
 * Cyrillic in place — a `[a-z]` split would reduce those headlines to nothing
 * and quietly exclude two sources from ever joining a cluster.
 */
export function topicTokens(title: string): Set<string> {
    const words = title
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
    return new Set(words);
}

const sharedCount = (a: Set<string>, b: Set<string>): number => {
    let n = 0;
    for (const w of a) {
        if (b.has(w)) {
            n++;
        }
    }
    return n;
};

export interface Surge {
    headline: string;
    sources: string[];
    since: string;
}

/**
 * Cross-source velocity: several outlets publishing the same story at once.
 *
 * This exists because there is no free real-time breaking-news API — GDELT
 * rate-limits from a residential IP and keyword search for "breaking" returns
 * playoff brackets. Convergence across sources we already poll is the signal
 * that costs nothing and improves as sources are added.
 *
 * O(n²) over at most a few dozen headlines, once per news refresh.
 */
export function detectSurge(items: NewsItem[], now: DateTime = DateTime.now()): Surge | null {
    const cutoff = now.minus({ minutes: WINDOW_MINUTES });
    const recent = items
        .map((item) => ({ item, at: DateTime.fromISO(item.publishedAt) }))
        .filter(({ at }) => at.isValid && at > cutoff)
        .map(({ item, at }) => ({ item, at, tokens: topicTokens(item.title) }));

    let best: Surge | null = null;
    let bestScore = 0;

    for (const seed of recent) {
        const group = recent.filter(
            (other) => other === seed || sharedCount(seed.tokens, other.tokens) >= MIN_SHARED,
        );
        const sources = [...new Set(group.map((g) => g.item.source))];
        if (sources.length < MIN_SOURCES) {
            continue;
        }
        // Prefer the widest convergence; break ties towards the newer story.
        const score = sources.length * 1_000_000 + seed.at.toMillis() / 1_000_000;
        if (score > bestScore) {
            bestScore = score;
            best = {
                headline: seed.item.title,
                sources,
                since: group.reduce((a, b) => (a.at < b.at ? a : b)).at.toISO()!,
            };
        }
    }
    return best;
}
