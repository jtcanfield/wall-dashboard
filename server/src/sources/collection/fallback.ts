import { DateTime } from "luxon";
import { CollectionEvent } from "../../shared";

/**
 * Hardcoded weekly schedule, used only when the ReCollect endpoint is
 * unreachable or changes shape. It is deliberately dumb: it knows nothing
 * about holiday shifts, which is exactly why ReCollect is preferred.
 */
const PICKUP_WEEKDAY = 2; // Luxon: 1 = Monday, so 2 = Tuesday

/**
 * Any known recycling pickup date. Parity is counted in whole weeks from here,
 * so correcting a drift is a one-line edit.
 */
const RECYCLING_ANCHOR = DateTime.fromISO("2026-01-06");

export function fallbackSchedule(from: DateTime, days = 14): CollectionEvent[] {
    const events: CollectionEvent[] = [];
    for (let i = 0; i < days; i++) {
        const day = from.plus({ days: i }).startOf("day");
        if (day.weekday !== PICKUP_WEEKDAY) {
            continue;
        }
        const weeksSinceAnchor = Math.round(day.diff(RECYCLING_ANCHOR, "weeks").weeks);
        events.push({
            date: day.toFormat("yyyy-LL-dd"),
            services: weeksSinceAnchor % 2 === 0 ? ["trash", "recycling"] : ["trash"],
        });
    }
    return events;
}
