import { isNews, rejectionReason } from "./filter";
import { selectVisible } from "./news.service";

const item = (
    title: string,
    link = "https://example.com/2026/08/23/politics/x/index.html",
    publishedAt: string | null = "2026-08-23T12:00:00Z",
) => ({ title, link, publishedAt });

describe("news filler filter", () => {
    it("keeps ordinary political reporting", () => {
        expect(isNews(item("Senate blocks vote to replace committee chair"))).toBe(true);
        expect(isNews(item("US warns Russia over Zaporizhzhia nuclear plant"))).toBe(true);
        expect(isNews(item("Mayors to get powers to overrule local councils on planning"))).toBe(
            true,
        );
    });

    it("drops undated entries", () => {
        // The decisive rule: evergreen commerce pages are the ones without dates,
        // which is exactly why they outlive an age cutoff that drops real news.
        expect(rejectionReason(item("Anything at all", undefined, null))).toBe("undated");
    });

    it("drops commerce and lifestyle sections by URL path", () => {
        const paths = [
            "https://www.cnn.com/cnn-underscored/reviews/best-bidets",
            "https://www.cnn.com/cnn-underscored/deals/best-amazon-deals-2023-04-12",
            "https://www.cnn.com/audio/podcasts/the-assignment/episodes/42a2",
            "https://www.theguardian.com/lifeandstyle/2026/aug/23/something",
            "https://www.bbc.co.uk/sport/athletics/articles/c9989lm0vkro",
            "https://www.cnn.com/travel/article/worlds-longest-cycling-tunnel/index.html",
        ];
        for (const link of paths) {
            expect(rejectionReason(item("A perfectly newsy sounding headline", link))).toBe(
                "filler-path",
            );
        }
    });

    it("matches sections, not substrings of the article slug", () => {
        // The bug this guards: a naive substring match rejects "transport" for
        // containing "sport", and a political story about deals for "deals".
        const newsy = [
            "https://www.bbc.co.uk/news/articles/transport-strike-latest",
            "https://www.npr.org/2026/08/23/nx-s1-1/trump-deals-with-congress",
            "https://www.pbs.org/newshour/politics/senator-reviews-the-budget",
            "https://www.npr.org/2026/08/23/nx-s1-2/arts-funding-bill-passes-house",
        ];
        for (const link of newsy) {
            expect(rejectionReason(item("Ordinary reporting", link))).toBeNull();
        }
    });

    it("drops listicles and gift guides published under a news path", () => {
        const titles = [
            "50+ products to make your life easier and our planet cleaner",
            "42 of the most useful travel products you can buy on Amazon",
            "Mother's Day is around the corner. Here are 50+ thoughtful gifts she'll love",
            "The 7 best high-yield savings accounts of April 2026",
            "The 10 best Amazon deals to shop this week",
            "The beloved Dyson Supersonic hair dryer is at its lowest price ever",
            "Podcast: One country musician is calling for other artists to speak up",
            "We stopped using aluminum foil for cooking and you should too",
        ];
        for (const title of titles) {
            expect(rejectionReason(item(title))).toBe("filler-title");
        }
    });

    it("does not mistake real news for commerce", () => {
        // These contain filler-adjacent words but are reporting.
        expect(isNews(item("Trump announces new tariffs on Chinese goods"))).toBe(true);
        expect(isNews(item("Supreme Court to hear case on food stamp benefits"))).toBe(true);
        expect(isNews(item("Best-selling author testifies before House committee"))).toBe(true);
    });
});

const headline = (source: string, minutesAgo: number) => ({
    id: `${source}-${minutesAgo}`,
    title: `${source} headline ${minutesAgo}`,
    link: `https://example.com/${source}/${minutesAgo}`,
    source,
    publishedAt: new Date(Date.UTC(2026, 7, 24, 12, 0, 0) - minutesAgo * 60_000).toISOString(),
});

describe("visible-headline selection", () => {
    // Sixteen fresh US items, then much older EU and Russian ones — the exact
    // shape that pushed Новая off the panel once the feed set reached thirteen.
    const crowded = [
        ...Array.from({ length: 16 }, (_, i) => headline("NPR", i)),
        headline("DW", 400),
        headline("Euronews", 420),
        headline("France 24", 440),
        headline("Meduza", 900),
        headline("Новая", 1_100),
    ];

    it("guarantees each region its floor even when outranked on recency", () => {
        const picked = selectVisible(crowded, 16);
        const sources = picked.map((i) => i.source);

        expect(picked).toHaveLength(16);
        expect(sources.filter((s) => ["Meduza", "Новая"].includes(s))).toHaveLength(2);
        expect(sources.filter((s) => ["DW", "Euronews", "France 24"].includes(s))).toHaveLength(3);
    });

    it("still renders strictly newest-first, so a reserved item sinks", () => {
        const picked = selectVisible(crowded, 16);
        const times = picked.map((i) => Date.parse(i.publishedAt));

        expect([...times].sort((a, b) => b - a)).toEqual(times);
        // The floors decide membership, never position: the oldest reserved
        // item lands at the bottom rather than jumping the queue.
        expect(picked[picked.length - 1]!.source).toBe("Новая");
        expect(picked[0]!.source).toBe("NPR");
    });

    it("does not pad a region past its floor when nothing else competes", () => {
        const quiet = [headline("NPR", 1), headline("Meduza", 2), headline("Новая", 3)];
        expect(selectVisible(quiet, 16).map((i) => i.source)).toEqual(["NPR", "Meduza", "Новая"]);
    });

    it("compares instants, not ISO strings, across differing UTC offsets", () => {
        // Same moment, two offsets. A lexical compare orders these by the
        // offset rather than by the time.
        const east = { ...headline("BBC", 0), publishedAt: "2026-08-24T15:00:00+03:00" };
        const west = { ...headline("NPR", 0), publishedAt: "2026-08-24T13:00:00+00:00" };
        expect(selectVisible([east, west], 16).map((i) => i.source)).toEqual(["NPR", "BBC"]);
    });
});
