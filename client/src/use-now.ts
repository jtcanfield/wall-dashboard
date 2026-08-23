import { useEffect, useState } from "preact/hooks";
import { DateTime } from "luxon";

/**
 * A ticking clock, so relative timestamps and staleness indicators keep moving
 * between server pushes rather than freezing until the next one lands.
 */
export function useNow(intervalMs = 20_000): DateTime {
    const [now, setNow] = useState(() => DateTime.now());
    useEffect(() => {
        const id = setInterval(() => setNow(DateTime.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}
