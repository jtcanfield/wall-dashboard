import { useEffect, useState } from "preact/hooks";

/**
 * Cycles an index through a set of faces, each holding for its own duration.
 *
 * Per-face timing rather than one shared interval because the faces are not
 * equally important: a breaking alert takes a longer turn than the bin
 * schedule does. A chained setTimeout rather than setInterval, since the delay
 * has to change between ticks.
 *
 * Holds at 0 when there is only one face, so a lone message never animates
 * against itself, and resets whenever the set changes — otherwise removing a
 * face would leave the index pointing past the end for one tick.
 */
export function useRotation(holdsMs: number[]): number {
    const [index, setIndex] = useState(0);
    const count = holdsMs.length;
    // The array is rebuilt every render, so its identity is useless as a
    // dependency. The joined durations are what actually decides the schedule.
    const schedule = holdsMs.join(",");

    useEffect(() => {
        setIndex(0);
        if (count <= 1) {
            return;
        }

        const holds = schedule.split(",").map(Number);
        let timer: ReturnType<typeof setTimeout>;

        const queue = (current: number): void => {
            timer = setTimeout(() => {
                const next = (current + 1) % count;
                setIndex(next);
                queue(next);
            }, holds[current] ?? holds[0]!);
        };
        queue(0);

        return () => {
            clearTimeout(timer);
        };
    }, [schedule, count]);

    return Math.min(index, Math.max(count - 1, 0));
}
