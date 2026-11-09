import type { WeatherHour } from "@shared/types";
import { localMillis } from "../time";

export interface Conditions {
    temperatureF: number;
    temperatureC: number;
    /** Null when the source gave no usable code — render nothing rather than a guess. */
    icon: string | null;
    label: string;
}

/**
 * WMO 4677 code to an emoji.
 *
 * Emoji rather than drawn icons because they are instantly readable at a
 * glance from across a room, which is the whole job of this header. The cost
 * is a font dependency: `fonts-noto-color-emoji` has to be installed on the
 * Wyse or these render as tofu boxes, exactly like the Cyrillic headlines did.
 * provision.sh installs it.
 *
 * Only the variants that genuinely differ after dark carry a night form. Rain
 * at night is still rain; a clear sky is not.
 */
const WMO: ReadonlyArray<readonly [max: number, day: string, night: string, label: string]> = [
    [0, "☀️", "🌙", "Clear"],
    [1, "🌤️", "🌙", "Mainly clear"],
    [2, "⛅", "☁️", "Partly cloudy"],
    [3, "☁️", "☁️", "Overcast"],
    [48, "🌫️", "🌫️", "Fog"],
    [57, "🌦️", "🌦️", "Drizzle"],
    [67, "🌧️", "🌧️", "Rain"],
    [77, "🌨️", "🌨️", "Snow"],
    [82, "🌦️", "🌦️", "Showers"],
    [86, "🌨️", "🌨️", "Snow showers"],
    [99, "⛈️", "⛈️", "Thunderstorm"],
];

export function describeCode(
    code: number | null,
    isDay: boolean,
): { icon: string | null; label: string } {
    if (code === null) {
        return { icon: null, label: "" };
    }
    // The table is banded by upper bound: codes 45 and 48 are both fog, 61
    // through 67 are all rain. Matching the first band the code falls inside
    // keeps the whole WMO range covered without listing every number.
    for (const [max, day, night, label] of WMO) {
        if (code <= max) {
            return { icon: isDay ? day : night, label };
        }
    }
    return { icon: null, label: "" };
}

export const toCelsius = (f: number): number => ((f - 32) * 5) / 9;

/**
 * Conditions at the hour nearest now.
 *
 * Nearest sample, never interpolated — the same rule the commute readouts
 * follow, and for the same reason: these are hourly forecasts, and inventing a
 * between-hours precision they do not have is false confidence. More than
 * ninety minutes from any sample means the feed has gone stale enough that a
 * number would be misleading, so nothing is shown.
 */
export function currentConditions(hourly: WeatherHour[], now = Date.now()): Conditions | null {
    if (hourly.length === 0) {
        return null;
    }

    let nearest = hourly[0]!;
    let bestGap = Math.abs(localMillis(nearest.time) - now);
    for (const hour of hourly) {
        const gap = Math.abs(localMillis(hour.time) - now);
        if (gap < bestGap) {
            bestGap = gap;
            nearest = hour;
        }
    }

    if (bestGap > 90 * 60_000 || Number.isNaN(nearest.temperatureF)) {
        return null;
    }

    const { icon, label } = describeCode(nearest.weatherCode, nearest.isDay);
    return {
        temperatureF: nearest.temperatureF,
        temperatureC: toCelsius(nearest.temperatureF),
        icon,
        label,
    };
}
