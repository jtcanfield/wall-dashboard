import type { CacheEntry, FxData, Quote } from "@shared/types";
import { EXPECTED_INTERVAL_MS } from "@shared/types";
import { Stale } from "../components/stale";
import { Sparkline } from "./sparkline";
import { formatRate } from "../colors";

interface Props {
    entry: CacheEntry<FxData>;
}

const COLOR: Record<Quote, string> = {
    EUR: "--eur",
    CNY: "--cny",
    RUB: "--rub",
};

export function FxPanel({ entry }: Props) {
    const series = entry.data?.series ?? [];

    return (
        <section class="panel">
            <header class="panel__head">
                <span class="panel__title">Currency</span>
                <Stale entry={entry} expectedMs={EXPECTED_INTERVAL_MS.fx} />
            </header>
            <div class="panel__body">
                {series.length === 0 ? (
                    <span class="empty">No rates yet</span>
                ) : (
                    <div class="fx">
                        {series.map((s) => (
                            <div class="fx__row" key={s.quote}>
                                <div>
                                    <div class="fx__pair">
                                        {s.base}/{s.quote}
                                    </div>
                                    <div class="fx__rate">
                                        {s.latest === null ? "—" : formatRate(s.latest)}
                                    </div>
                                </div>
                                <Sparkline points={s.points} colorVar={COLOR[s.quote]} />
                                <div
                                    class={`fx__change${
                                        s.changePct === null
                                            ? ""
                                            : s.changePct >= 0
                                              ? " fx__change--up"
                                              : " fx__change--down"
                                    }`}
                                >
                                    {s.changePct === null
                                        ? ""
                                        : `${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(1)}%`}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
