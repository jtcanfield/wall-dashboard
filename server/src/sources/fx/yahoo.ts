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
    // quietly lose precision in the chart history.
    const symbol = `${BASE}${quote}=X`;
    const url =
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}` + `?interval=1d&range=1mo`;

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

    const cutoff = DateTime.now().minus({ days: windowDays }).startOf("day");
    const points: FxPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
        const close = closes[i];
        const at = timestamps[i];
        if (close === null || close === undefined || at === undefined) {
            continue;
        }
        const day = DateTime.fromSeconds(at);
        if (day < cutoff) {
            continue;
        }
        points.push({ date: day.toFormat("yyyy-LL-dd"), rate: close });
    }

    if (points.length === 0) {
        throw new Error(`Yahoo returned no usable closes for ${symbol}`);
    }

    // The live price is carried in meta regardless of candle interval, so one
    // daily-interval request yields both the month of history and the current
    // rate. Fall back to the last close if meta is missing.
    const marketTime = result.meta?.regularMarketTime;
    const latest = result.meta?.regularMarketPrice ?? points[points.length - 1]!.rate;

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
