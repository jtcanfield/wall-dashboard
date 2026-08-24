import { useEffect, useState } from "preact/hooks";
import type { DashboardState } from "@shared/types";
import { emptyState } from "@shared/types";

export interface Connection {
    state: DashboardState;
    /** False between a dropped connection and the next successful frame. */
    connected: boolean;
}

/** Backoff for our own reconnects, so a server that is down is not hammered. */
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * How long a silent stream is allowed to go before it is assumed dead.
 *
 * The server pushes on *every* poll, success or failure — `CacheService.refresh`
 * always writes the entry back — and Twitch polls every 90 seconds. So a frame
 * is guaranteed at least that often, and several minutes of silence cannot be
 * normal. Generous enough that it never fires against a healthy stream.
 */
const SILENCE_LIMIT_MS = 4 * 60_000;

/**
 * One EventSource, one state object, replaced wholesale on every message.
 *
 * **The browser's automatic reconnect is not enough, and assuming it was cost
 * this display eight hours.** `EventSource` only retries on *transport*
 * failures. If the endpoint answers with an HTTP error status — which is what
 * the Vite proxy does whenever the API is restarting, and what any error page
 * in front of the server would do — the spec requires the browser to fail the
 * connection **permanently**: `readyState` goes to CLOSED, `onerror` fires
 * once, and nothing ever retries. Observed exactly that: a kiosk page left open
 * overnight sat showing eight-hour-old headlines while a fresh EventSource to
 * the same URL connected instantly.
 *
 * On an unattended wall display that is the worst possible failure, because it
 * looks completely fine. So the reconnect is supervised here:
 *
 * 1. A CLOSED socket is terminal to the browser, so we rebuild it ourselves.
 * 2. A watchdog rebuilds a stream that has gone quiet, which also covers the
 *    half-open connection the browser never notices at all.
 *
 * Recovery is free once reconnected: the server holds a BehaviorSubject, so a
 * new subscriber is replayed full current state immediately rather than waiting
 * for the next poll.
 */
export function useDashboard(): Connection {
    const [state, setState] = useState<DashboardState>(emptyState);
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        let source: EventSource | null = null;
        let retryDelay = RECONNECT_BASE_MS;
        let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        let stopped = false;

        const scheduleReconnect = (): void => {
            if (stopped || reconnectTimer !== undefined) {
                return;
            }
            reconnectTimer = setTimeout(() => {
                reconnectTimer = undefined;
                retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_MS);
                connect();
            }, retryDelay);
        };

        const armWatchdog = (): void => {
            clearTimeout(watchdog);
            watchdog = setTimeout(() => {
                // Nothing has arrived in far longer than the server's slowest
                // guaranteed push. Tear it down rather than trusting a socket
                // that may be open but no longer carrying anything.
                connect();
            }, SILENCE_LIMIT_MS);
        };

        function connect(): void {
            if (stopped) {
                return;
            }
            source?.close();
            source = new EventSource("/api/stream");

            source.onopen = () => setConnected(true);

            source.onmessage = (event: MessageEvent<string>) => {
                retryDelay = RECONNECT_BASE_MS;
                setConnected(true);
                armWatchdog();
                try {
                    setState(JSON.parse(event.data) as DashboardState);
                } catch {
                    // A malformed frame is not worth blanking the display over.
                }
            };

            source.onerror = () => {
                setConnected(false);
                // CONNECTING means the browser is retrying by itself and will
                // succeed or end up CLOSED; the watchdog covers it either way.
                // CLOSED is terminal, and is the case that used to strand the
                // page forever.
                if (source?.readyState === EventSource.CLOSED) {
                    scheduleReconnect();
                }
            };

            armWatchdog();
        }

        connect();

        return () => {
            stopped = true;
            clearTimeout(reconnectTimer);
            clearTimeout(watchdog);
            source?.close();
        };
    }, []);

    return { state, connected };
}
