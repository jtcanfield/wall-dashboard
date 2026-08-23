import { Injectable, Logger } from "@nestjs/common";
import { StateService } from "../state/state.service";
import { DashboardState, SourceKey } from "../shared";

export type EntryData<K extends SourceKey> = NonNullable<DashboardState[K]["data"]>;

/**
 * The cache contract, in one place, applied to every fetcher.
 *
 * The rule that matters: a failed refresh never clears previous data. A panel
 * silently showing yesterday's exchange rates is far better than one that
 * blanks because an upstream had a bad minute.
 */
@Injectable()
export class CacheService {
    private readonly log = new Logger(CacheService.name);

    constructor(private readonly state: StateService) {}

    async refresh<K extends SourceKey>(
        key: K,
        fetcher: () => Promise<EntryData<K>>,
    ): Promise<void> {
        const previous = this.state.current[key];
        try {
            const data = await fetcher();
            this.state.setEntry(key, {
                data,
                fetchedAt: new Date().toISOString(),
                error: null,
            } as DashboardState[K]);
            this.log.log(`${key}: refreshed`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // Keep `data` and the original `fetchedAt` so the client can show how
            // stale it is. Only the error field changes.
            this.state.setEntry(key, { ...previous, error: message } as DashboardState[K]);
            this.log.warn(`${key}: refresh failed, serving stale — ${message}`);
        }
    }
}
