import { useEffect, useState } from "preact/hooks";
import type { DashboardState } from "@shared/types";
import { emptyState } from "@shared/types";

export interface Connection {
    state: DashboardState;
    /** False between a dropped connection and EventSource's automatic retry. */
    connected: boolean;
}

/**
 * One EventSource, one state object, replaced wholesale on every message.
 *
 * EventSource is the point of using SSE here: reconnect-with-backoff is built
 * into the browser, so an unattended display recovers from a server restart or
 * a flapping switch port without any code of ours running.
 */
export function useDashboard(): Connection {
    const [state, setState] = useState<DashboardState>(emptyState);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        const source = new EventSource("/api/stream");
        source.onopen = () => setConnected(true);
        source.onerror = () => setConnected(false);
        source.onmessage = (event: MessageEvent<string>) => {
            setConnected(true);
            try {
                setState(JSON.parse(event.data) as DashboardState);
            } catch {
                // A malformed frame is not worth blanking the display over.
            }
        };
        return () => source.close();
    }, []);

    return { state, connected };
}
