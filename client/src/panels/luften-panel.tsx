import type { LuftenState } from "@shared/types";
import { clockTime } from "../time";

interface Props {
    luften: LuftenState | null;
}

/**
 * Today only, in a single short bar.
 *
 * The 3-day lookahead strip is still computed and still travels in the state
 * payload — it just isn't drawn. In a Raleigh summer every one of those days
 * reads "None", so four boxes of mostly-nothing were spending the left
 * column's height on a signal that is empty for months at a time. The height
 * goes to the weather chart instead.
 */
export function LuftenPanel({ luften }: Props) {
    // All-day windows sit inside exchange windows, so show them first — they are
    // the stronger signal and the one the owner is actually picturing.
    const windows = [...(luften?.today.windows ?? [])].sort((a, b) =>
        a.kind === b.kind ? a.start.localeCompare(b.start) : a.kind === "all-day" ? -1 : 1,
    );

    return (
        <section class="panel luften">
            <header class="panel__head">
                <span class="panel__title">Luften today</span>
                {luften && (
                    <span class="luften__indoor">
                        indoor {Math.round(luften.indoorDewPointF)}°F dewpoint ·{" "}
                        {luften.indoorSource}
                    </span>
                )}
            </header>

            <div class="panel__body luften__windows">
                {!luften ? (
                    <span class="empty">Waiting for weather…</span>
                ) : windows.length === 0 ? (
                    // Explicit, not blank: the 67–75°F band is empty most of a Raleigh
                    // summer, and an empty panel reads as a bug.
                    <span class="luften__none">No window today</span>
                ) : (
                    windows.slice(0, 4).map((w) => (
                        <span
                            key={`${w.kind}-${w.start}`}
                            class={`luften__window luften__window--${w.kind}`}
                        >
                            <b>
                                {clockTime(w.start)}–{clockTime(w.end)}
                            </b>
                            <small>{w.kind === "all-day" ? "open all day" : "burst"}</small>
                        </span>
                    ))
                )}
            </div>
        </section>
    );
}
