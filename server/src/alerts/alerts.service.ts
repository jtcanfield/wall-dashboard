import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { DateTime } from "luxon";
import { promises as fs } from "node:fs";
import { configPath } from "../paths";
import { StateService } from "../state/state.service";
import { BreakingAlert, BreakingKind, NewsItem } from "../shared";
import { stagger } from "../sources/stagger";
import { NwsAlert, fetchNwsAlerts } from "./nws";
import { detectSurge } from "./velocity";

const TEST_EVENT_PATH = configPath("breaking-test.json");

/** Wake County. Overridable because the zone is the one thing that moves. */
const DEFAULT_ZONE = "NCZ041";

/**
 * A velocity surge has no upstream "it's over" signal, so it expires on a
 * timer. Roughly the point at which a genuinely big story stops being the only
 * thing every outlet is publishing.
 */
const SURGE_TTL_MINUTES = 45;

/** Only one bar shows. Lower sorts first. */
const RANK: Record<BreakingKind, number> = { emergency: 0, weather: 1, developing: 2 };

/**
 * Owns the red bar.
 *
 * Two independent triggers, because there is no free real-time breaking-news
 * API to lean on (see CLAUDE.local.md — GDELT rate-limits and keyword search returns
 * playoff brackets):
 *
 * 1. NWS civil-emergency and severe-weather alerts for one zone, polled.
 * 2. Cross-source velocity over headlines the news module already fetched.
 *
 * This is the one service that reads another source's output. It does not talk
 * to NewsService — it reads the published state, same as the client does, so
 * the "sources never talk to each other" rule still holds.
 */
@Injectable()
export class AlertsService implements OnModuleInit {
    private readonly log = new Logger(AlertsService.name);
    private nws: NwsAlert[] = [];
    private testEvent: BreakingAlert | null = null;
    /** Guards against the state push we cause re-triggering our own listener. */
    private signature: string | null = null;

    constructor(private readonly state: StateService) {}

    async onModuleInit(): Promise<void> {
        await this.loadTestEvent();
        this.state.stream.subscribe(() => this.recompute());
        stagger("alerts", () => this.poll());
    }

    // A minute. The panel exists to say "this is happening now"; a fifteen
    // minute cadence would routinely show a shelter-in-place order that had
    // already been lifted.
    @Interval("alerts", 60_000)
    async poll(): Promise<void> {
        const zone = process.env["NWS_ZONE"] ?? DEFAULT_ZONE;
        try {
            this.nws = await fetchNwsAlerts(zone);
            if (this.nws.length > 0) {
                this.log.log(`NWS ${zone}: ${this.nws.map((a) => a.headline).join("; ")}`);
            }
        } catch (err) {
            // Same posture as every other fetcher: a failed refresh never
            // clears what we already had. An alert that is still live upstream
            // must not vanish because one poll timed out.
            this.log.warn(`NWS alert poll failed — ${String(err)}`);
        }
        this.recompute();
    }

    /**
     * The test event drives this exact code path rather than a separate render
     * branch — otherwise the thing that only ever runs during a real emergency
     * is the thing that was never exercised.
     */
    private async loadTestEvent(): Promise<void> {
        if (!process.env["BREAKING_TEST"]) {
            return;
        }
        try {
            const raw = await fs.readFile(TEST_EVENT_PATH, "utf8");
            const parsed = JSON.parse(raw) as Partial<BreakingAlert>;
            this.testEvent = {
                id: parsed.id ?? "breaking-test",
                kind: parsed.kind ?? "emergency",
                headline: parsed.headline ?? "Test alert",
                detail: parsed.detail ?? null,
                since: parsed.since ?? new Date().toISOString(),
                until: parsed.until ?? null,
            };
            this.log.warn(`BREAKING_TEST is set — forcing "${this.testEvent.headline}"`);
        } catch (err) {
            this.log.warn(`Could not load ${TEST_EVENT_PATH} — ${String(err)}`);
        }
    }

    private recompute(): void {
        const next = this.testEvent ?? this.pick();
        // Compare by identity and text, not by object: `since` is stable but a
        // re-poll rebuilds the object every minute, and pushing an equal value
        // would resnapshot the whole state file on a timer.
        const signature = next ? `${next.id}|${next.headline}|${next.until ?? ""}` : "";
        if (signature === this.signature) {
            return;
        }
        this.signature = signature;
        this.state.setBreaking(next);
        this.log.log(next ? `Breaking: ${next.headline}` : "Breaking cleared");
    }

    private pick(): BreakingAlert | null {
        const now = DateTime.now();
        const live = this.nws.filter((a) => {
            if (!a.until) {
                return true;
            }
            const until = DateTime.fromISO(a.until);
            return !until.isValid || until > now;
        });

        const candidates: BreakingAlert[] = [...live];

        const news = this.state.current.news.data as NewsItem[] | null;
        const surge = news ? detectSurge(news, now) : null;
        if (surge) {
            candidates.push({
                id: `surge-${surge.headline.slice(0, 60)}`,
                kind: "developing",
                headline: surge.headline,
                detail: surge.sources.join(", "),
                since: surge.since,
                until: DateTime.fromISO(surge.since).plus({ minutes: SURGE_TTL_MINUTES }).toISO(),
            });
        }

        if (candidates.length === 0) {
            return null;
        }
        return candidates.sort(
            (a, b) =>
                RANK[a.kind] - RANK[b.kind] ||
                DateTime.fromISO(b.since).toMillis() - DateTime.fromISO(a.since).toMillis(),
        )[0]!;
    }
}
