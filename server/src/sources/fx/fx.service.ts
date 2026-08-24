import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { DateTime } from "luxon";
import { CacheService } from "../../cache/cache.service";
import { getJson } from "../../cache/http";
import { FxData, FxPoint, FxSeries, Quote } from "../../shared";
import { TIMEZONE, stagger } from "../stagger";
import { fetchCbrRubPerUsd } from "./cbr";
import { fetchYahooSeries } from "./yahoo";

const BASE = "USD";
const QUOTES: Quote[] = ["EUR", "RUB", "CNY"];
const WINDOW_DAYS = 30;

/** GET /v2/currencies returns a flat array, not a code -> name map. */
interface CurrencyRow {
    iso_code?: string;
    /** Last date this currency has data for; a stale one is as bad as a missing one. */
    end_date?: string;
}

/** GET /v2/rates returns one row per date *per quote*, not a nested map. */
interface RateRow {
    date?: string;
    base?: string;
    quote?: string;
    rate?: number;
}

@Injectable()
export class FxService implements OnModuleInit {
    private readonly log = new Logger(FxService.name);
    /** null until the first successful /v2/currencies probe. */
    private frankfurterHasRub: boolean | null = null;

    constructor(private readonly cache: CacheService) {}

    onModuleInit(): void {
        stagger("fx", () => this.refresh());
    }

    // Fifteen minutes, not daily. The point of the panel is deciding when to
    // exchange money, which a once-a-day reference rate cannot support.
    @Interval("fx", 15 * 60_000)
    async refresh(): Promise<void> {
        await this.cache.refresh("fx", () => this.fetchAll());
    }

    private async fetchAll(): Promise<FxData> {
        const attempts = await Promise.allSettled(
            QUOTES.map((quote) => fetchYahooSeries(quote, WINDOW_DAYS)),
        );

        const series: FxSeries[] = [];
        const missing: Quote[] = [];
        attempts.forEach((attempt, i) => {
            const quote = QUOTES[i]!;
            if (attempt.status === "fulfilled") {
                series.push(attempt.value);
            } else {
                missing.push(quote);
                this.log.warn(`Yahoo failed for ${quote} — ${String(attempt.reason)}`);
            }
        });

        // The daily sources only fill gaps. They are a safety net under an
        // undocumented endpoint, not a second opinion to reconcile against.
        if (missing.length > 0) {
            series.push(...(await this.fetchDaily(missing)));
        }

        if (series.length === 0) {
            throw new Error("no FX provider returned a usable series");
        }

        const order = QUOTES.indexOf.bind(QUOTES);
        return { series: series.sort((a, b) => order(a.quote) - order(b.quote)) };
    }

    /** Daily-reference fallback: Frankfurter, plus CBR for the ruble. */
    private async fetchDaily(quotes: Quote[]): Promise<FxSeries[]> {
        const to = DateTime.now().setZone(TIMEZONE).startOf("day");
        const from = to.minus({ days: WINDOW_DAYS });

        const needsRub = quotes.includes("RUB");
        const hasRub = needsRub ? await this.probeRubSupport() : false;
        const viaFrankfurter = quotes.filter((q) => q !== "RUB" || hasRub);

        const series: FxSeries[] = [];
        try {
            const byQuote = await this.fetchFrankfurter(from, viaFrankfurter);
            for (const quote of viaFrankfurter) {
                series.push(toSeries(quote, byQuote[quote] ?? [], "frankfurter"));
            }
        } catch (err) {
            this.log.warn(`Frankfurter fallback failed — ${String(err)}`);
        }

        if (needsRub && !hasRub) {
            try {
                series.push(toSeries("RUB", await fetchCbrRubPerUsd(from, to), "cbr"));
            } catch (err) {
                // One missing pair must not fail the others.
                this.log.warn(`CBR fallback failed — ${String(err)}`);
            }
        }
        return series;
    }

    /**
     * Verify RUB coverage before relying on it, as the notes require. Frankfurter
     * v2 is multi-provider so it may well carry RUB from a non-ECB source; if it
     * doesn't, that one pair comes from CBR instead.
     */
    private async probeRubSupport(): Promise<boolean> {
        if (this.frankfurterHasRub !== null) {
            return this.frankfurterHasRub;
        }
        try {
            const rows = await getJson<CurrencyRow[]>("https://api.frankfurter.dev/v2/currencies");
            const rub = rows.find((c) => c.iso_code === "RUB");
            // Verified 2026-08-23: v2 carries RUB from a non-ECB provider, current to
            // today. The end_date check is what catches that quietly going away — the
            // ECB's own RUB reference rate has been suspended since 1 March 2022, so
            // a stale end_date is exactly the failure mode to expect here.
            const cutoff = DateTime.now().minus({ days: 7 }).toFormat("yyyy-LL-dd");
            this.frankfurterHasRub = rub !== undefined && (rub.end_date ?? "") >= cutoff;
            this.log.log(
                `Frankfurter RUB support: ${this.frankfurterHasRub} (end_date ${rub?.end_date ?? "none"})`,
            );
        } catch (err) {
            this.log.warn(
                `Could not probe Frankfurter currencies, falling back to CBR — ${String(err)}`,
            );
            this.frankfurterHasRub = false;
        }
        return this.frankfurterHasRub;
    }

    private async fetchFrankfurter(
        from: DateTime,
        quotes: Quote[],
    ): Promise<Partial<Record<Quote, FxPoint[]>>> {
        if (quotes.length === 0) {
            return {};
        }
        const url =
            `https://api.frankfurter.dev/v2/rates?from=${from.toFormat("yyyy-LL-dd")}` +
            `&base=${BASE}&quotes=${quotes.join(",")}`;

        const rows = await getJson<RateRow[]>(url);
        const wanted = new Set<string>(quotes);

        const out: Partial<Record<Quote, FxPoint[]>> = {};
        for (const row of rows) {
            if (!row.date || !row.quote || typeof row.rate !== "number") {
                continue;
            }
            if (!wanted.has(row.quote)) {
                continue;
            }
            (out[row.quote as Quote] ??= []).push({
                t: DateTime.fromISO(row.date).toSeconds(),
                rate: row.rate,
            });
        }
        for (const list of Object.values(out)) {
            list.sort((a, b) => a.t - b.t);
        }
        return out;
    }
}

function toSeries(quote: Quote, points: FxPoint[], source: FxSeries["source"]): FxSeries {
    const first = points[0];
    const last = points[points.length - 1];
    return {
        quote,
        base: BASE,
        points,
        latest: last?.rate ?? null,
        // Daily reference rates carry no intraday timestamp.
        asOf: null,
        changePct:
            first && last && first.rate !== 0
                ? ((last.rate - first.rate) / first.rate) * 100
                : null,
        source,
    };
}
