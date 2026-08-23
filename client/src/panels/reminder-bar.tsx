import { DateTime } from "luxon";
import type { Reminder } from "@shared/types";

interface Props {
    reminders: Reminder[];
    now: DateTime;
}

/**
 * Full width across the top. It is the glance-first item, and full width means
 * a long reminder absorbs its own text length without reflowing any panel.
 */
export function ReminderBar({ reminders, now }: Props) {
    return (
        <section class={`panel reminders${reminders.length === 0 ? " reminders--idle" : ""}`}>
            {reminders.length === 0 ? (
                <span>Nothing to do</span>
            ) : (
                reminders.slice(0, 3).map((r) => (
                    <span class="reminders__item" key={r.id}>
                        <i class="reminders__dot" />
                        {r.text}
                    </span>
                ))
            )}
            <span class="reminders__clock">{now.toFormat("cccc d LLLL · h:mm a")}</span>
        </section>
    );
}
