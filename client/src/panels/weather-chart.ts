import uPlot from "uplot";
import type { AlignedData, Options } from "uplot";
import { DateTime } from "luxon";
import type { LuftenState, LuftenWindow, WeatherHour } from "@shared/types";
import { localMillis } from "../time";
import { alpha, cssVar as css } from "../colors";

/**
 * The chart covers 36 hours: a little context behind, the rest ahead.
 *
 * Long enough to carry tomorrow morning's commute marker and any luften
 * window that opens overnight, short enough that the hourly rain bars stay
 * wide enough to read.
 */
const HOURS_BEHIND = 3;
const HOURS_AHEAD = 33;

/** Local hours at which a vertical commute marker is drawn. */
const COMMUTE_HOURS = [8, 15];

/** Rain-chance bars: 70% of the hour slot, capped so a short window doesn't slab. */
const bars = uPlot.paths.bars?.({ size: [0.7, 26] });

export type WeatherSeries = AlignedData;

export function buildSeries(hourly: WeatherHour[]): WeatherSeries {
    const from = Date.now() - HOURS_BEHIND * 3_600_000;
    const to = Date.now() + HOURS_AHEAD * 3_600_000;

    const visible = hourly.filter((h) => {
        const t = localMillis(h.time);
        return t >= from && t <= to;
    });

    // Rain chance comes second so uPlot draws it first, behind both lines.
    return [
        visible.map((h) => localMillis(h.time) / 1000),
        visible.map((h) => h.precipitationProbability),
        visible.map((h) => h.temperatureF),
        visible.map((h) => h.dewPointF),
    ];
}

/**
 * Draws the luften bands and the 08:00/15:00 commute markers.
 *
 * Bands go in `drawClear` so they sit behind the series; the commute lines go
 * in `draw` so they sit on top of them.
 */
function markersPlugin(
    getLuften: () => LuftenState | null,
): NonNullable<Options["plugins"]>[number] {
    const bandFor = (kind: LuftenWindow["kind"]) =>
        kind === "all-day" ? alpha(css("--good"), 0.16) : alpha(css("--accent"), 0.09);

    return {
        hooks: {
            drawClear: (u: uPlot) => {
                const luften = getLuften();
                if (!luften) {
                    return;
                }
                const windows = [luften.today, ...luften.lookahead].flatMap((d) => d.windows);
                const ctx = u.ctx;
                ctx.save();
                // Exchange windows first so an all-day band (a strict subset) layers on top.
                for (const kind of ["exchange", "all-day"] as const) {
                    ctx.fillStyle = bandFor(kind);
                    for (const w of windows.filter((x) => x.kind === kind)) {
                        const x0 = u.valToPos(localMillis(w.start) / 1000, "x", true);
                        const x1 = u.valToPos(localMillis(w.end) / 1000, "x", true);
                        if (x1 <= u.bbox.left || x0 >= u.bbox.left + u.bbox.width) {
                            continue;
                        }
                        const left = Math.max(x0, u.bbox.left);
                        ctx.fillRect(
                            left,
                            u.bbox.top,
                            Math.min(x1, u.bbox.left + u.bbox.width) - left,
                            u.bbox.height,
                        );
                    }
                }
                ctx.restore();
            },

            draw: (u: uPlot) => {
                const [min, max] =
                    u.scales["x"]?.min !== undefined && u.scales["x"]?.max !== undefined
                        ? [u.scales["x"].min as number, u.scales["x"].max as number]
                        : [0, 0];
                if (!max) {
                    return;
                }

                const ctx = u.ctx;
                ctx.save();
                ctx.strokeStyle = alpha(css("--ink-faint"), 0.85);
                ctx.setLineDash([6, 6]);
                ctx.lineWidth = 2;
                ctx.fillStyle = css("--ink-faint");
                ctx.font = '13px "Noto Sans", sans-serif';

                let day = DateTime.fromMillis(min * 1000).startOf("day");
                const end = DateTime.fromMillis(max * 1000);
                while (day < end) {
                    for (const hour of COMMUTE_HOURS) {
                        const at = day.set({ hour }).toSeconds();
                        if (at < min || at > max) {
                            continue;
                        }
                        const x = u.valToPos(at, "x", true);
                        ctx.beginPath();
                        ctx.moveTo(x, u.bbox.top);
                        ctx.lineTo(x, u.bbox.top + u.bbox.height);
                        ctx.stroke();
                        ctx.fillText(`${hour}:00`, x + 6, u.bbox.top + 16);
                    }
                    day = day.plus({ days: 1 });
                }
                ctx.restore();
            },
        },
    };
}

export function chartOptions(
    width: number,
    height: number,
    getLuften: () => LuftenState | null,
): Options {
    const grid = { stroke: alpha(css("--border"), 1), width: 1 };
    const ticks = { stroke: alpha(css("--border"), 1), size: 5 };

    return {
        width,
        height,
        // No cursor, no legend, no hover state — nobody is pointing at this screen.
        cursor: { show: false },
        legend: { show: false },
        padding: [12, 12, 0, 0],
        plugins: [markersPlugin(getLuften)],
        scales: {
            x: { time: true },
            temp: { auto: true },
            pct: { range: [0, 100] },
        },
        axes: [
            {
                stroke: css("--ink-faint"),
                grid,
                ticks,
                font: '14px "Noto Sans", sans-serif',
                space: 90,
            },
            {
                scale: "temp",
                stroke: css("--ink-faint"),
                grid,
                ticks,
                font: '14px "Noto Sans", sans-serif',
                values: (_u, splits) => splits.map((v) => `${Math.round(v)}°`),
            },
            {
                scale: "pct",
                side: 1,
                stroke: css("--ink-faint"),
                grid: { show: false },
                ticks,
                font: '14px "Noto Sans", sans-serif',
                values: (_u, splits) => splits.map((v) => `${Math.round(v)}%`),
            },
        ],
        series: [
            {},
            {
                // Hourly chance of rain, as bars rising from the baseline. A line-and-
                // fill was unreadable: on a dry day it sits flat against the bottom
                // axis and looks like chart furniture rather than data.
                scale: "pct",
                label: "Rain",
                stroke: alpha(css("--accent"), 0.55),
                fill: alpha(css("--accent"), 0.3),
                width: 1,
                paths: bars,
            },
            { scale: "temp", label: "Temp", stroke: css("--temp"), width: 3 },
            { scale: "temp", label: "Dewpoint", stroke: css("--dew"), width: 3, dash: [8, 4] },
        ],
    };
}
