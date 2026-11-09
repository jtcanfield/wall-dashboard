import { useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import uPlot from "uplot";
import type { CacheEntry, LuftenState, WeatherData } from "@shared/types";
import { EXPECTED_INTERVAL_MS } from "@shared/types";
import { Stale } from "../components/stale";
import { buildSeries, chartOptions } from "./weather-chart";
import { currentConditions } from "./weather-icon";

interface Props {
    entry: CacheEntry<WeatherData>;
    luften: LuftenState | null;
}

export function WeatherPanel({ entry, luften }: Props) {
    const host = useRef<HTMLDivElement>(null);
    const chart = useRef<uPlot | null>(null);
    // Read through a ref so the uPlot draw hooks always see current luften
    // without the chart having to be rebuilt.
    const luftenRef = useRef<LuftenState | null>(luften);
    luftenRef.current = luften;

    const series = useMemo(() => buildSeries(entry.data?.hourly ?? []), [entry.data]);
    // Recomputed per frame rather than per minute: the state push already
    // arrives on every poll, and an hourly value cannot change faster than
    // the data behind it.
    const now = useMemo(() => currentConditions(entry.data?.hourly ?? []), [entry.data]);

    useLayoutEffect(() => {
        const el = host.current;
        if (!el) {
            return;
        }
        const u = new uPlot(
            chartOptions(el.clientWidth, el.clientHeight, () => luftenRef.current),
            series,
            el,
        );
        chart.current = u;
        return () => {
            // uPlot is here partly because it tears down cleanly. This display runs
            // for sixteen hours without a reload.
            u.destroy();
            chart.current = null;
        };
    }, []);

    useLayoutEffect(() => {
        chart.current?.setData(series);
    }, [series]);

    useEffect(() => {
        // The "now" line is drawn from Date.now() inside a draw hook, so it
        // only moves when something asks the chart to redraw. Weather polls
        // every fifteen minutes, which would march the line across in visible
        // seven-pixel jumps. A minute is below the width of a pixel here.
        const id = setInterval(() => chart.current?.redraw(false), 60_000);
        return () => {
            clearInterval(id);
        };
    }, []);

    useLayoutEffect(() => {
        // `redraw(false)`, never `redraw()`. The default rebuilds paths, which
        // internally re-pins the x scale to `scaleX.min/max` — and uPlot converges
        // scales asynchronously, so when luften and weather arrive in the same
        // commit this runs while that range is still null and pins x to null
        // permanently. The result is a chart with correct axes and no plotted
        // series. Only the bands changed here, so skip the path rebuild entirely.
        chart.current?.redraw(false);
    }, [luften]);

    return (
        <section class="panel">
            <header class="panel__head">
                <span class="panel__title">Weather</span>
                {now && (
                    <span class="weather__now">
                        {now.icon && (
                            <span class="weather__icon" role="img" aria-label={now.label}>
                                {now.icon}
                            </span>
                        )}
                        <span class="weather__temp">{Math.round(now.temperatureF)}°F</span>
                        <span class="weather__temp weather__temp--alt">
                            {Math.round(now.temperatureC)}°C
                        </span>
                    </span>
                )}
                <span class="weather__legend">
                    <span>
                        <i class="swatch" style="background: var(--temp)" />
                        Temp
                    </span>
                    <span>
                        <i class="swatch" style="background: var(--dew)" />
                        Dewpoint
                    </span>
                    <span>
                        <i class="swatch swatch--bar" />
                        Rain chance
                    </span>
                    <Stale entry={entry} expectedMs={EXPECTED_INTERVAL_MS.weather} />
                </span>
            </header>
            <div class="panel__body">
                <div class="weather__chart" ref={host} />
            </div>
        </section>
    );
}
