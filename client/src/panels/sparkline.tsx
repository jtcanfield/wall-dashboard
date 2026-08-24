import { useLayoutEffect, useMemo, useRef } from "preact/hooks";
import uPlot from "uplot";
import type { AlignedData } from "uplot";
import type { FxPoint } from "@shared/types";
import { alpha, cssVar, formatRate } from "../colors";

interface Props {
    points: FxPoint[];
    /** A CSS custom property name, e.g. '--cny'. Resolved against :root. */
    colorVar: string;
}

/**
 * ECB-sourced rates are business-day only, so a month of data has weekend
 * gaps. A stepped path holds Friday's rate flat across Saturday and Sunday,
 * which is what actually happened — a straight diagonal would invent movement.
 */
const stepped = uPlot.paths.stepped?.({ align: 1 });

export function Sparkline({ points, colorVar }: Props) {
    const host = useRef<HTMLDivElement>(null);
    const chart = useRef<uPlot | null>(null);

    const data = useMemo<AlignedData>(
        // Already epoch seconds, which is exactly what uPlot time scales want.
        () => [points.map((p) => p.t), points.map((p) => p.rate)],
        [points],
    );

    useLayoutEffect(() => {
        const el = host.current;
        if (!el) {
            return;
        }

        const line = cssVar(colorVar);
        const gridStroke = alpha(cssVar("--border"), 1);

        const u = new uPlot(
            {
                width: el.clientWidth,
                height: el.clientHeight,
                cursor: { show: false },
                legend: { show: false },
                padding: [8, 4, 2, 4],
                scales: { x: { time: true } },
                axes: [
                    // No date labels — the pair and the window are stated in the panel.
                    // The vertical gridlines alone give the plot a sense of time passing.
                    {
                        show: true,
                        stroke: "transparent",
                        size: 0,
                        gap: 0,
                        ticks: { show: false },
                        grid: { stroke: gridStroke, width: 1 },
                        values: (_u, splits) => splits.map(() => ""),
                    },
                    {
                        // A real value axis. Three labels is enough to read the range at a
                        // glance without the sparkline turning into a full chart.
                        side: 1,
                        size: 52,
                        gap: 4,
                        stroke: cssVar("--ink-faint"),
                        font: '11px "Noto Sans", sans-serif',
                        ticks: { show: false },
                        grid: { stroke: gridStroke, width: 1 },
                        splits: (_u, _idx, min, max) => [min, (min + max) / 2, max],
                        values: (_u, splits) => splits.map((v) => formatRate(v)),
                    },
                ],
                series: [
                    {},
                    {
                        stroke: line,
                        width: 2,
                        // The fill is what turns a floating line into something that reads
                        // as a graph; the area is the point, not decoration.
                        fill: alpha(line, 0.14),
                        paths: stepped,
                    },
                ],
            },
            data,
            el,
        );
        chart.current = u;
        return () => {
            u.destroy();
            chart.current = null;
        };
    }, []);

    useLayoutEffect(() => {
        chart.current?.setData(data);
    }, [data]);

    return <div class="fx__spark" ref={host} />;
}
