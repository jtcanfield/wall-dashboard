import { DateTime } from "luxon";
import type { ComponentChildren } from "preact";
import type { BreakingAlert, LuftenState, Reminder } from "@shared/types";
import { clockTime } from "../time";
import { useRotation } from "../use-rotation";
import { WorldClock } from "./world-clock";

interface Props {
    reminders: Reminder[];
    luften: LuftenState | null;
    breaking: BreakingAlert | null;
    now: DateTime;
}

/**
 * What the red bar calls itself.
 *
 * "DEVELOPING" rather than "BREAKING" for a velocity surge, deliberately: that
 * trigger is several outlets converging on a story, which is weaker evidence
 * than an IPAWS alert and should not claim the same certainty.
 */
const BREAKING_LABEL: Record<BreakingAlert["kind"], string> = {
    emergency: "Emergency",
    weather: "Severe weather",
    developing: "Developing",
};

/** How long each face holds before flipping to the next. */
const ROTATE_MS = 9_000;

/**
 * Per-item animation delay, driving the staggered flap.
 *
 * A custom property rather than a direct animation-delay so the timing lives
 * in the stylesheet with the keyframes, and this only supplies the index.
 */
const flapDelay = (index: number) => ({ "--flap-index": String(index) });

interface Face {
    id: string;
    body: ComponentChildren;
}

function remindersFace(reminders: Reminder[]): Face | null {
    if (reminders.length === 0) {
        return null;
    }
    return {
        id: "reminders",
        body: reminders.slice(0, 3).map((reminder, i) => (
            <span class="topbar__item" key={reminder.id} style={flapDelay(i)}>
                <i class="topbar__dot topbar__dot--reminder" />
                {reminder.text}
            </span>
        )),
    };
}

function luftenFace(luften: LuftenState | null): Face | null {
    if (!luften) {
        return null;
    }

    // All-day windows sit inside exchange windows, so show them first — they
    // are the stronger signal and the one the owner is actually picturing.
    const windows = [...luften.today.windows].sort((a, b) => {
        if (a.kind === b.kind) {
            return a.start.localeCompare(b.start);
        }
        return a.kind === "all-day" ? -1 : 1;
    });

    if (windows.length === 0) {
        // Explicit, not blank: the 67-75°F band is empty for most of a Raleigh
        // summer, and a topbar that simply skipped the face would look broken.
        return {
            id: "luften-none",
            body: (
                <span class="topbar__item topbar__item--quiet" style={flapDelay(0)}>
                    <i class="topbar__dot topbar__dot--none" />
                    No lüften today
                </span>
            ),
        };
    }

    return {
        id: "luften",
        body: windows.slice(0, 2).map((window, i) => (
            <span class="topbar__item" key={`${window.kind}-${window.start}`} style={flapDelay(i)}>
                <i class={`topbar__dot topbar__dot--${window.kind}`} />
                {clockTime(window.start)}–{clockTime(window.end)}
                <small class="topbar__note">
                    {window.kind === "all-day" ? "windows open" : "air out"}
                </small>
            </span>
        )),
    };
}

/**
 * Full width across the top, and the only thing on screen that changes what it
 * is showing rather than just its values.
 *
 * Reminders and today's luften windows both want the glance-first slot and
 * neither fills it, so they take turns. Faces with nothing to say drop out of
 * the rotation entirely, which means a single remaining face simply holds
 * rather than flipping between itself.
 */
export function TopBar({ reminders, luften, breaking, now }: Props) {
    const faces = [remindersFace(reminders), luftenFace(luften)].filter(
        (face): face is Face => face !== null,
    );

    if (faces.length === 0) {
        faces.push({
            id: "idle",
            body: (
                <span class="topbar__item topbar__item--quiet" style={flapDelay(0)}>
                    Nothing to do
                </span>
            ),
        });
    }

    // Unconditionally, before any branch. An early return above this would
    // change the hook order the moment an alert arrived or cleared, which is
    // the one time the bar absolutely has to keep working.
    const index = useRotation(faces.length, ROTATE_MS);
    const face = faces[index] ?? faces[0]!;

    // Breaking takes the whole bar. It does not join the rotation: an alert
    // that flips away every nine seconds to show the bin schedule is not an
    // alert. The clocks stay because dropping them would shift the layout of
    // the one element the eye is already going to.
    if (breaking) {
        return (
            <section class={`panel topbar topbar--breaking topbar--${breaking.kind}`}>
                <div class="topbar__face">
                    <span class="topbar__item" style={flapDelay(0)}>
                        <i class="topbar__siren" />
                        <strong class="topbar__label">{BREAKING_LABEL[breaking.kind]}</strong>
                        <span class="topbar__headline">{breaking.headline}</span>
                    </span>
                </div>
                <WorldClock now={now} />
                <span class="topbar__clock">{now.toFormat("cccc d LLLL · h:mm a")}</span>
            </section>
        );
    }

    return (
        <section class="panel topbar">
            {/* Times the flip, so the change never arrives unannounced. Keyed by
                the rotation index so it restarts in step with the face; omitted
                entirely when there is nothing to rotate to. */}
            {faces.length > 1 && (
                <span
                    class="topbar__progress"
                    key={`progress-${index}`}
                    style={{ animationDuration: `${ROTATE_MS}ms` }}
                />
            )}

            {/* Keyed by face id so Preact replaces the node on every change,
                which restarts the flip animation without any imperative code. */}
            <div class="topbar__face" key={face.id}>
                {face.body}
            </div>

            <WorldClock now={now} />
            <span class="topbar__clock">{now.toFormat("cccc d LLLL · h:mm a")}</span>
        </section>
    );
}
