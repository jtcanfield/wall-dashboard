import { useEffect, useState } from "preact/hooks";

/**
 * Cycles an index through `count` faces on a fixed interval.
 *
 * Holds at 0 when there is only one face, so a lone message never animates
 * against itself, and resets whenever the count changes — otherwise removing a
 * face would leave the index pointing past the end for one tick.
 */
export function useRotation(count: number, intervalMs: number): number {
    const [index, setIndex] = useState(0);

    useEffect(() => {
        setIndex(0);
        if (count <= 1) {
            return;
        }
        const id = setInterval(() => {
            setIndex((current) => (current + 1) % count);
        }, intervalMs);
        return () => {
            clearInterval(id);
        };
    }, [count, intervalMs]);

    return Math.min(index, Math.max(count - 1, 0));
}
