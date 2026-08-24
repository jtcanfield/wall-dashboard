import { DateTime } from "luxon";
import { classify, toAlerts } from "./nws";
import { detectSurge, topicTokens } from "./velocity";

const props = (over: Record<string, string> = {}) => ({
    event: "Tornado Warning",
    severity: "Severe",
    urgency: "Immediate",
    status: "Actual",
    messageType: "Alert",
    ...over,
});

describe("NWS alert classification", () => {
    it("raises an emergency for IPAWS civil alerts regardless of severity", () => {
        expect(classify(props({ event: "Shelter In Place Warning", severity: "Unknown" }))).toBe(
            "emergency",
        );
        expect(classify(props({ event: "Child Abduction Emergency", severity: "Unknown" }))).toBe(
            "emergency",
        );
    });

    it("raises severe weather on severity, not on an event-name list", () => {
        expect(classify(props({ event: "Tornado Warning" }))).toBe("weather");
        expect(classify(props({ event: "Some Warning NWS Adds In 2030" }))).toBe("weather");
    });

    it("ignores the routine traffic that makes up most of the endpoint", () => {
        expect(classify(props({ event: "Special Weather Statement", severity: "Moderate" }))).toBe(
            null,
        );
        // Administrative Message is in the same IPAWS family but is housekeeping.
        expect(classify(props({ event: "Administrative Message", severity: "Minor" }))).toBe(null);
    });

    it("never fires for drills — NWS publishes Test and Exercise alerts live", () => {
        expect(classify(props({ status: "Test" }))).toBe(null);
        expect(classify(props({ status: "Exercise" }))).toBe(null);
    });

    it("ignores cancellations and non-urgent alerts", () => {
        expect(classify(props({ messageType: "Cancel" }))).toBe(null);
        expect(classify(props({ urgency: "Future" }))).toBe(null);
        expect(classify(props({ urgency: "Past" }))).toBe(null);
    });

    it("prefers the written headline over the bare event name", () => {
        const [alert] = toAlerts([
            {
                id: "urn:oid:1",
                properties: props({
                    headline: "Tornado Warning issued for Wake County until 4:15 PM",
                    areaDesc: "Wake, NC",
                    effective: "2026-08-24T15:30:00-04:00",
                    ends: "2026-08-24T16:15:00-04:00",
                }),
            },
        ]);
        expect(alert!.headline).toContain("Wake County");
        expect(alert!.until).toBe("2026-08-24T16:15:00-04:00");
    });
});

describe("cross-source velocity", () => {
    const now = DateTime.fromISO("2026-08-24T12:00:00-04:00");
    const item = (source: string, title: string, minutesAgo: number) => ({
        id: `${source}-${minutesAgo}`,
        title,
        link: `https://example.com/${source}/${minutesAgo}`,
        source,
        publishedAt: now.minus({ minutes: minutesAgo }).toISO()!,
    });

    it("fires when enough distinct sources converge on one story", () => {
        const surge = detectSurge(
            [
                item("BBC", "Explosion reported at Brussels summit venue", 20),
                item("DW", "Brussels summit venue explosion injures four", 14),
                item("France 24", "Four injured in Brussels explosion at summit", 8),
                item("NPR", "Senate confirms new trade representative", 5),
            ],
            now,
        );
        expect(surge).not.toBeNull();
        expect(surge!.sources).toHaveLength(3);
        expect(surge!.headline).toContain("Brussels");
    });

    it("does not fire when one source repeats itself", () => {
        expect(
            detectSurge(
                [
                    item("BBC", "Brussels summit venue explosion latest", 20),
                    item("BBC", "Brussels explosion: what we know", 14),
                    item("BBC", "Brussels explosion inquiry opens", 8),
                ],
                now,
            ),
        ).toBeNull();
    });

    it("does not fire on unrelated headlines that merely coincide in time", () => {
        expect(
            detectSurge(
                [
                    item("BBC", "Flooding closes rail line in Yorkshire", 20),
                    item("DW", "German coalition agrees budget compromise", 14),
                    item("NPR", "Senate confirms new trade representative", 8),
                ],
                now,
            ),
        ).toBeNull();
    });

    it("ignores convergence that is already stale", () => {
        expect(
            detectSurge(
                [
                    item("BBC", "Brussels summit venue explosion injures four", 400),
                    item("DW", "Brussels summit venue explosion latest", 380),
                    item("France 24", "Brussels explosion at summit venue", 360),
                ],
                now,
            ),
        ).toBeNull();
    });

    it("tokenises Cyrillic, so a failed translation still joins a cluster", () => {
        // Translation fails open and leaves the original in place. A [a-z]
        // split would empty those headlines and silently exclude two sources.
        expect(topicTokens("Взрыв на саммите в Брюсселе").size).toBeGreaterThan(1);
    });
});
