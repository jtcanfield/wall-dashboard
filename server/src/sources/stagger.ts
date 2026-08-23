import { Logger } from "@nestjs/common";

export const TIMEZONE = "America/New_York";

/**
 * Boot offsets, in seconds, so starting the process doesn't fire five
 * simultaneous outbound requests.
 */
const OFFSETS: Record<string, number> = {
    weather: 1,
    news: 4,
    twitch: 7,
    fx: 10,
    collection: 13,
};

const log = new Logger("Stagger");

export function stagger(
    source: keyof typeof OFFSETS | string,
    run: () => Promise<void> | void,
): void {
    const seconds = OFFSETS[source] ?? 15;
    setTimeout(() => {
        void (async () => {
            try {
                await run();
            } catch (err) {
                log.error(`Initial ${source} run threw: ${String(err)}`);
            }
        })();
    }, seconds * 1_000).unref();
}
