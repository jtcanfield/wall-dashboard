import { DateTime } from "luxon";
import { CollectionEvent, CollectionService, Reminder } from "../shared";

export interface ReminderRule {
    id: string;
    /** Three-letter weekday names, e.g. ["Mon", "Tue"]. */
    days: string[];
    /** HH:mm local. Optional bounds on when the reminder is visible. */
    after?: string;
    before?: string;
    text: string;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const minutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(":");
    return Number(h) * 60 + Number(m ?? 0);
};

export function evaluateRules(rules: ReminderRule[], now: DateTime): Reminder[] {
    const today = WEEKDAYS[now.weekday - 1];
    const nowMinutes = now.hour * 60 + now.minute;

    return rules
        .filter((r) => today !== undefined && r.days.includes(today))
        .filter((r) => (r.after === undefined ? true : nowMinutes >= minutes(r.after)))
        .filter((r) => (r.before === undefined ? true : nowMinutes < minutes(r.before)))
        .map((r) => ({ id: r.id, text: r.text }));
}

const LABEL: Record<CollectionService, string> = {
    trash: "Trash",
    recycling: "Recycling",
    "yard-waste": "Yard waste",
    other: "Collection",
};

const joinLabels = (services: CollectionService[]): string => {
    const names = services.map((s) => LABEL[s]);
    if (names.length <= 1) {
        return names[0] ?? "Collection";
    }
    return `${names.slice(0, -1).join(", ")} + ${names[names.length - 1]}`;
};

/**
 * Reminders driven by the collection feed rather than by computed weekly
 * parity — the feed has already resolved holiday shifts, so it wins.
 *
 * Visible from 15:00 the day before until noon on pickup day.
 */
export function collectionReminders(events: CollectionEvent[], now: DateTime): Reminder[] {
    return events.flatMap((event): Reminder[] => {
        const pickup = DateTime.fromISO(event.date, { zone: now.zone }).startOf("day");
        if (!pickup.isValid) {
            return [];
        }

        const from = pickup.minus({ days: 1 }).set({ hour: 15 });
        const until = pickup.set({ hour: 12 });
        if (now < from || now >= until) {
            return [];
        }

        const when = now < pickup ? "tonight" : "this morning";
        return [
            {
                id: `collection-${event.date}`,
                text: `${joinLabels(event.services)} out ${when} — pickup ${pickup.toFormat("cccc")} morning`,
            },
        ];
    });
}
