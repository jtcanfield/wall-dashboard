import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BehaviorSubject, Observable, debounceTime } from 'rxjs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { dataPath } from '../paths';
import {
  CacheEntry,
  DashboardState,
  LuftenState,
  Reminder,
  SourceKey,
  emptyState,
} from '../shared';

const SNAPSHOT_PATH = dataPath('cache.json');

/**
 * Owns the single BehaviorSubject the whole dashboard hangs off.
 *
 * BehaviorSubject (not Subject) is load-bearing: it replays its current value
 * to every new subscriber, so a client that connects to the SSE stream gets
 * full current state immediately and then every subsequent update through the
 * same code path. That is why there is no `GET /api/state` and no
 * connected-but-empty gap.
 *
 * Source modules push into this. Sources never talk to each other.
 */
@Injectable()
export class StateService implements OnModuleInit {
  private readonly log = new Logger(StateService.name);
  private readonly subject = new BehaviorSubject<DashboardState>(emptyState());

  async onModuleInit(): Promise<void> {
    await this.restore();

    // Snapshot on write, debounced — a burst of sources landing at boot should
    // cost one file write, not six.
    this.subject.pipe(debounceTime(1_000)).subscribe((state) => {
      void this.persist(state);
    });
  }

  get stream(): Observable<DashboardState> {
    return this.subject.asObservable();
  }

  get current(): DashboardState {
    return this.subject.value;
  }

  /** Replace one source's cache entry and push the whole state. */
  setEntry<K extends SourceKey>(key: K, entry: DashboardState[K]): void {
    this.push({ [key]: entry } as Pick<DashboardState, K>);
  }

  setLuften(luften: LuftenState | null): void {
    this.push({ luften });
  }

  setReminders(reminders: Reminder[]): void {
    this.push({ reminders });
  }

  private push(partial: Partial<DashboardState>): void {
    this.subject.next({
      ...this.subject.value,
      ...partial,
      generatedAt: new Date().toISOString(),
    });
  }

  /**
   * Restore the last snapshot so a restart repaints instantly instead of
   * showing six empty panels for 90 seconds.
   */
  private async restore(): Promise<void> {
    try {
      const raw = await fs.readFile(SNAPSHOT_PATH, 'utf8');
      const saved = JSON.parse(raw) as Partial<DashboardState>;
      this.subject.next({ ...emptyState(), ...saved, generatedAt: new Date().toISOString() });
      this.log.log('Restored dashboard state from snapshot');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.log.warn(`Could not restore snapshot: ${String(err)}`);
      }
    }
  }

  private async persist(state: DashboardState): Promise<void> {
    try {
      await fs.mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
      await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(state), 'utf8');
    } catch (err) {
      this.log.warn(`Could not write snapshot: ${String(err)}`);
    }
  }
}

/** Convenience for fetchers: a successful refresh. */
export const fresh = <T,>(data: T): CacheEntry<T> => ({
  data,
  fetchedAt: new Date().toISOString(),
  error: null,
});
