/**
 * The single contract between server and client.
 *
 * The whole DashboardState is pushed on every update and the client replaces
 * its state wholesale — no partial updates, no per-widget subscription wiring.
 */

/**
 * Cache contract, applied to every fetcher.
 *
 * `fetchedAt` is an ISO 8601 string rather than a Date because this type
 * crosses the SSE wire as JSON. Keeping it a string on both sides removes a
 * whole class of "it's a Date on the server and a string in the browser" bugs;
 * Luxon parses it with DateTime.fromISO in one call.
 */
export interface CacheEntry<T> {
  data: T | null;
  fetchedAt: string | null;
  error: string | null;
}

export type SourceKey = 'weather' | 'fx' | 'news' | 'twitch' | 'collection';

/** How stale an entry may get before the UI shows an age indicator, in ms. */
export const EXPECTED_INTERVAL_MS: Record<SourceKey, number> = {
  weather: 15 * 60_000,
  news: 10 * 60_000,
  twitch: 90_000,
  fx: 24 * 60 * 60_000,
  collection: 24 * 60 * 60_000,
};

/* ------------------------------------------------------------------ weather */

/**
 * One hourly sample. `time` is a local wall-clock ISO string with no offset:
 * Open-Meteo is asked for timezone=America/New_York so the API does the DST
 * math for us and the 08:00/15:00 commute markers survive it for free.
 */
export interface WeatherHour {
  time: string;
  temperatureF: number;
  precipitationIn: number;
  precipitationProbability: number;
  dewPointF: number;
  relativeHumidity: number;
}

export interface WeatherData {
  hourly: WeatherHour[];
  source: 'open-meteo' | 'nws';
}

/* ----------------------------------------------------------------- currency */

export type Quote = 'EUR' | 'CNY' | 'RUB';

export interface FxPoint {
  /** YYYY-MM-DD. Business days only — step the line, never diagonal across a weekend. */
  date: string;
  rate: number;
}

export interface FxSeries {
  quote: Quote;
  base: string;
  points: FxPoint[];
  latest: number | null;
  /** Percent change across the whole window, or null if fewer than two points. */
  changePct: number | null;
  source: 'frankfurter' | 'cbr';
}

export interface FxData {
  series: FxSeries[];
}

/* --------------------------------------------------------------------- news */

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
  /** ISO 8601 with offset. The client renders this as a relative timestamp. */
  publishedAt: string | null;
}

/* ------------------------------------------------------------------- twitch */

export interface TwitchStream {
  userLogin: string;
  userName: string;
  title: string;
  gameName: string;
  viewerCount: number;
  startedAt: string;
  /** Placeholders already substituted server-side. */
  thumbnailUrl: string;
}

/* --------------------------------------------------------------- collection */

export type CollectionService = 'trash' | 'recycling' | 'yard-waste' | 'other';

export interface CollectionEvent {
  /** YYYY-MM-DD, already holiday-shifted by ReCollect at the source. */
  date: string;
  services: CollectionService[];
}

/* ------------------------------------------------------------------ luften */

export type LuftenKind = 'exchange' | 'all-day';

export interface LuftenWindow {
  /** Local wall-clock ISO, linearly interpolated between hourly points. */
  start: string;
  end: string;
  kind: LuftenKind;
}

export interface LuftenDay {
  /** YYYY-MM-DD */
  date: string;
  windows: LuftenWindow[];
}

export interface LuftenState {
  indoorTempF: number;
  indoorRelativeHumidity: number;
  indoorDewPointF: number;
  /** 'assumed' until a real sensor reading arrives. */
  indoorSource: 'assumed' | 'sensor';
  today: LuftenDay;
  /** 3-day strip so the panel stays informative through a Raleigh summer. */
  lookahead: LuftenDay[];
}

/* --------------------------------------------------------------- reminders */

export interface Reminder {
  id: string;
  text: string;
}

/* ---------------------------------------------------------------- dashboard */

export interface DashboardState {
  /** ISO 8601 with offset. Changes on every push. */
  generatedAt: string;
  weather: CacheEntry<WeatherData>;
  fx: CacheEntry<FxData>;
  news: CacheEntry<NewsItem[]>;
  twitch: CacheEntry<TwitchStream[]>;
  collection: CacheEntry<CollectionEvent[]>;
  /** Derived from weather + indoor conditions; null until weather lands. */
  luften: LuftenState | null;
  /** Evaluated server-side per push. Never stale, so not a CacheEntry. */
  reminders: Reminder[];
}

export const emptyEntry = <T,>(): CacheEntry<T> => ({
  data: null,
  fetchedAt: null,
  error: null,
});

export const emptyState = (): DashboardState => ({
  generatedAt: new Date().toISOString(),
  weather: emptyEntry<WeatherData>(),
  fx: emptyEntry<FxData>(),
  news: emptyEntry<NewsItem[]>(),
  twitch: emptyEntry<TwitchStream[]>(),
  collection: emptyEntry<CollectionEvent[]>(),
  luften: null,
  reminders: [],
});
