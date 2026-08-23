import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { CacheService } from '../../cache/cache.service';
import { getJson } from '../../cache/http';
import { CollectionEvent, CollectionService as Service } from '../../shared';
import { TIMEZONE, stagger } from '../stagger';
import { fallbackSchedule } from './fallback';

interface RecollectResponse {
  events?: {
    day?: string;
    flags?: { name?: string; subject?: string }[];
  }[];
}

const LOOKAHEAD_DAYS = 14;

/** ReCollect flag names vary by municipality, so match loosely. */
function classify(flag: string): Service {
  const f = flag.toLowerCase();
  if (f.includes('recycl')) return 'recycling';
  if (f.includes('yard') || f.includes('leaf') || f.includes('brush')) return 'yard-waste';
  if (f.includes('garbage') || f.includes('trash') || f.includes('refuse')) return 'trash';
  return 'other';
}

/**
 * Raleigh's calendar runs on ReCollect (Routeware), which resolves holiday
 * shifts and Schedule A/B recycling parity at the source — so there is no
 * hand-maintained holiday table anywhere in this repo.
 *
 * The endpoint is undocumented, hence the daily poll, the cache, and the
 * hardcoded weekly fallback: a schema change must not blank the reminder bar.
 */
@Injectable()
export class CollectionService implements OnModuleInit {
  private readonly log = new Logger(CollectionService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    stagger('collection', () => this.refresh());
  }

  @Cron('0 4 * * *', { name: 'collection', timeZone: TIMEZONE })
  async refresh(): Promise<void> {
    await this.cache.refresh('collection', () => this.fetchEvents());
  }

  private async fetchEvents(): Promise<CollectionEvent[]> {
    const today = DateTime.now().setZone(TIMEZONE).startOf('day');
    const placeId = this.config.get<string>('RECOLLECT_PLACE_ID');
    const serviceId = this.config.get<string>('RECOLLECT_SERVICE_ID');

    if (!placeId || !serviceId) {
      this.log.warn('RECOLLECT_PLACE_ID / RECOLLECT_SERVICE_ID unset — using weekly fallback');
      return fallbackSchedule(today, LOOKAHEAD_DAYS);
    }

    try {
      const url =
        `https://api.recollect.net/api/places/${placeId}/services/${serviceId}/events` +
        `?nomerge=1&hide=reminder_only&after=${today.toFormat('yyyy-LL-dd')}` +
        `&before=${today.plus({ days: LOOKAHEAD_DAYS }).toFormat('yyyy-LL-dd')}`;

      const res = await getJson<RecollectResponse>(url);
      const events = (res.events ?? []).flatMap((e): CollectionEvent[] => {
        if (!e.day) return [];
        const services = [
          ...new Set((e.flags ?? []).map((f) => classify(f.name ?? f.subject ?? ''))),
        ].filter((s) => s !== 'other');
        return services.length > 0 ? [{ date: e.day, services }] : [];
      });

      if (events.length === 0) throw new Error('ReCollect returned no usable events');
      return events.sort((a, b) => a.date.localeCompare(b.date));
    } catch (err) {
      this.log.warn(`ReCollect failed, using weekly fallback — ${String(err)}`);
      return fallbackSchedule(today, LOOKAHEAD_DAYS);
    }
  }
}
