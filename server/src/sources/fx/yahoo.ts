import { DateTime } from "luxon";
import { FxPoint, FxSeries, Quote } from "../../shared";
import { getJson } from "../../cache/http";

interface YahooChart {
    chart?: {
        result?: {
            meta?: {
                regularMarketPrice?: number;
                regularMarketTime?: number;
                currency?: string;
            };
            timestamp?: number[];
            indicators?: { quote?: { close?: (number | null)[] }[] };
        }[];
        error?: { description?: string } | null;
    };
}

const BASE = "USD";

/**
 * Six significant figures.
 *
 * Yahoo stores these as 32-bit floats, so a rate that is really 0.8665 comes
 * back as 0.8665000200271606. At 506 points across three pairs that noise is
 * pure payload — and the whole DashboardState is pushed on every update, so
 * it is paid for again on every frame. No FX quote needs more than this.
 */
const round = (n: number): number => Number(n.toPrecision(6));

/**
 * Hourly candles across the whole month.
 *
 * Measured 2026-08-23 for USDEUR=X: 1h/1mo yields 506 points over 31 days,
 * 30m yields 1010, 1d only 22. The sparkline is ~347px wide, so hourly is
 * already slightly oversampled and finer granularity would only cost payload.
 * `meta.regularMarketPrice` is present regardless of interval, so this one
 * request still carries the live rate as well.
 */
const INTERVAL = "1h";
const RANGE = "1mo";

/**
 * Yahoo Finance's chart endpoint, used for near-real-time rates.
 *
 * The daily-reference sources cannot answer "should I exchange money now?".
 * Frankfurter carries the ECB reference rate, published once per working day
 * around 16:00 CET — measured on a Sunday it was still serving Friday's
 * figures — and open.er-api refreshes once every 24 hours. Polling either more
 * often just re-fetches identical numbers.
 *
 * This endpoint is undocumented and unversioned, which is why it is wrapped in
 * a fallback to the daily sources rather than trusted outright. Same posture as
 * the ReCollect feed: use it, but never let it be the only thing standing
 * between the panel and a number.
 */
export async function fetchYahooSeries(quote: Quote, windowDays: number): Promise<FxSeries> {
    // Direct USD-based pairs exist for all three quotes, so no inversion is
    // needed — USDEUR=X rather than EURUSD=X, which would need 1/x and would
    // quietly lose precision across the whole chart history.
    const symbol = `${BASE}${quote}=X`;
    const url =
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}` +
        `?interval=${INTERVAL}&range=${RANGE}`;

    const res = await getJson<YahooChart>(url, {
        // The endpoint 404s unauthenticated-looking clients without a UA.
        headers: { "User-Agent": "Mozilla/5.0 (wall-dashboard)" },
    });

    const result = res.chart?.result?.[0];
    if (!result) {
        throw new Error(res.chart?.error?.description ?? `Yahoo returned no result for ${symbol}`);
    }

    const timestamps = result.timestamp ?? [];
    const closes = result.indicators?.quote?.[0]?.close ?? [];

    // Candles with a null close are market closures, not zero rates. Dropping
    // them is what leaves the weekend as a genuine gap for the step to hold
    // across, rather than a plunge to nothing.
    const cutoff = DateTime.now().minus({ days: windowDays }).toSeconds();
    const points: FxPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
        const close = closes[i];
        const at = timestamps[i];
        if (close === null || close === undefined || at === undefined || at < cutoff) {
            continue;
        }
        points.push({ t: at, rate: round(close) });
    }

    if (points.length === 0) {
        throw new Error(`Yahoo returned no usable closes for ${symbol}`);
    }

    const marketTime = result.meta?.regularMarketTime;
    const latest = round(result.meta?.regularMarketPrice ?? points[points.length - 1]!.rate);

    const first = points[0]!;
    return {
        quote,
        base: BASE,
        points,
        latest,
        asOf: marketTime ? DateTime.fromSeconds(marketTime).toISO() : null,
        changePct: first.rate === 0 ? null : ((latest - first.rate) / first.rate) * 100,
        source: "yahoo",
    };
}
