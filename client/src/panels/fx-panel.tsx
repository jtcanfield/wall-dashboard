import type { CacheEntry, FxData, Quote } from "@shared/types";
import { EXPECTED_INTERVAL_MS } from "@shared/types";
import { Stale } from "../components/stale";
import { Sparkline } from "./sparkline";
import { formatRate } from "../colors";
import { DateTime } from "luxon";

interface Props {
    entry: CacheEntry<FxData>;
}

const COLOR: Record<Quote, string> = {
    EUR: "--eur",
    CNY: "--cny",
    RUB: "--rub",
};

/**
 * Three pairs side by side under the weather chart.
 *
 * Stacked in the right-hand column each chart was 466x69, which is a sparkline
 * — a shape, not a graph. Across the full width of the left column they get
 * roughly 330x150 each, enough to carry gridlines and a value axis.
 */
export function FxPanel({ entry }: Props) {
    const series = entry.data?.series ?? [];

    // The market timestamp, not our fetch time — what matters when deciding
    // whether a rate is worth acting on. Only intraday sources carry one.
    const newest = series
        .map((s) => s.asOf)
        .filter((at): at is string => at !== null)
        .sort()
        .pop();
    const quotedAt = newest ? DateTime.fromISO(newest).toFormat("h:mm a") : null;

    return (
        <section class="panel">
            <header class="panel__head">
                <span class="panel__title">Currency · 30 days</span>
                {quotedAt && <span class="fx__asof">live {quotedAt}</span>}
                <Stale entry={entry} expectedMs={EXPECTED_INTERVAL_MS.fx} />
            </header>
            <div class="panel__body">
                {series.length === 0 ? (
                    <span class="empty">No rates yet</span>
                ) : (
                    <div class="fx">
                        {series.map((s) => {
                            const direction =
                                s.changePct === null
                                    ? ""
                                    : s.changePct >= 0
                                      ? " fx__change--up"
                                      : " fx__change--down";
                            return (
                                <div class="fx__cell" key={s.quote}>
                                    <div class="fx__head">
                                        <span class="fx__pair">
                                            {s.base}/{s.quote}
                                        </span>
                                        <span class={`fx__change${direction}`}>
                                            {s.changePct === null
                                                ? ""
                                                : `${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(1)}%`}
                                        </span>
                                    </div>
                                    <div class="fx__rate">
                                        {s.latest === null ? "—" : formatRate(s.latest)}
                                    </div>
                                    <Sparkline points={s.points} colorVar={COLOR[s.quote]} />
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </section>
    );
}
