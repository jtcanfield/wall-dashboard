import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import { DateTime } from "luxon";
import { CacheService } from "../../cache/cache.service";
import { getJson } from "../../cache/http";
import { WeatherData, WeatherHour } from "../../shared";
import { TIMEZONE, stagger } from "../stagger";

interface OpenMeteoResponse {
    hourly?: {
        time?: string[];
        temperature_2m?: number[];
        precipitation?: number[];
        precipitation_probability?: (number | null)[];
        dew_point_2m?: number[];
        relative_humidity_2m?: number[];
    };
}

interface NwsPoints {
    properties?: { forecastHourly?: string };
}

interface NwsHourly {
    properties?: {
        periods?: {
            startTime: string;
            temperature: number;
            temperatureUnit: string;
            probabilityOfPrecipitation?: { value: number | null };
            dewpoint?: { value: number | null };
            relativeHumidity?: { value: number | null };
        }[];
    };
}

const FORECAST_DAYS = 4; // today + the 3-day lookahead strip

@Injectable()
export class WeatherService implements OnModuleInit {
    private readonly log = new Logger(WeatherService.name);

    constructor(
        private readonly cache: CacheService,
        private readonly config: ConfigService,
    ) {}

    onModuleInit(): void {
        stagger("weather", () => this.refresh());
    }

    @Interval("weather", 15 * 60_000)
    async refresh(): Promise<void> {
        await this.cache.refresh("weather", async () => {
            try {
                return await this.fetchOpenMeteo();
            } catch (err) {
                this.log.warn(`Open-Meteo failed, trying NWS — ${String(err)}`);
                return await this.fetchNws();
            }
        });
    }

    /**
     * `timezone=America/New_York` makes the API return local times, so no UTC
     * offset math happens anywhere in this codebase and the 08:00/15:00 commute
     * markers survive DST for free.
     */
    private async fetchOpenMeteo(): Promise<WeatherData> {
        const url = new URL("https://api.open-meteo.com/v1/forecast");
        url.searchParams.set("latitude", String(this.config.get("LATITUDE", 35.7796)));
        url.searchParams.set("longitude", String(this.config.get("LONGITUDE", -78.6382)));
        url.searchParams.set(
            "hourly",
            "temperature_2m,precipitation,precipitation_probability,dew_point_2m,relative_humidity_2m",
        );
        url.searchParams.set("timezone", TIMEZONE);
        url.searchParams.set("temperature_unit", "fahrenheit");
        url.searchParams.set("precipitation_unit", "inch");
        url.searchParams.set("forecast_days", String(FORECAST_DAYS));

        const res = await getJson<OpenMeteoResponse>(url.toString());
        const h = res.hourly;
        if (!h?.time?.length) {
            throw new Error("Open-Meteo returned no hourly series");
        }

        const hourly: WeatherHour[] = h.time.map((time, i) => ({
            time: time.slice(0, 16),
            temperatureF: h.temperature_2m?.[i] ?? NaN,
            precipitationIn: h.precipitation?.[i] ?? 0,
            precipitationProbability: h.precipitation_probability?.[i] ?? 0,
            dewPointF: h.dew_point_2m?.[i] ?? NaN,
            relativeHumidity: h.relative_humidity_2m?.[i] ?? NaN,
        }));

        return {
            hourly: hourly.filter((x) => !Number.isNaN(x.temperatureF)),
            source: "open-meteo",
        };
    }

    /**
     * NWS fallback. Its periods carry a real UTC offset, so they get converted
     * to the same offset-free local wall-clock strings Open-Meteo produces —
     * downstream code must not have to care which source it got.
     */
    private async fetchNws(): Promise<WeatherData> {
        const lat = this.config.get("LATITUDE", 35.7796);
        const lon = this.config.get("LONGITUDE", -78.6382);
        // api.weather.gov rejects requests without an identifying User-Agent.
        const init: RequestInit = { headers: { "User-Agent": "wall-dashboard (home display)" } };

        const points = await getJson<NwsPoints>(
            `https://api.weather.gov/points/${lat},${lon}`,
            init,
        );
        const hourlyUrl = points.properties?.forecastHourly;
        if (!hourlyUrl) {
            throw new Error("NWS returned no forecastHourly link");
        }

        const res = await getJson<NwsHourly>(hourlyUrl, init);
        const periods = res.properties?.periods ?? [];
        if (periods.length === 0) {
            throw new Error("NWS returned no periods");
        }

        const cutoff = DateTime.now()
            .setZone(TIMEZONE)
            .plus({ days: FORECAST_DAYS })
            .startOf("day");

        const mapped = periods
            .map((p) => {
                const local = DateTime.fromISO(p.startTime).setZone(TIMEZONE);
                const tempF =
                    p.temperatureUnit === "F" ? p.temperature : (p.temperature * 9) / 5 + 32;
                const dpC = p.dewpoint?.value;
                return {
                    time: local.toFormat("yyyy-MM-dd'T'HH:mm"),
                    at: local,
                    temperatureF: tempF,
                    // NWS hourly carries no precipitation amount, only probability.
                    precipitationIn: (p.probabilityOfPrecipitation?.value ?? 0) >= 50 ? 0.01 : 0,
                    precipitationProbability: p.probabilityOfPrecipitation?.value ?? 0,
                    dewPointF: dpC === null || dpC === undefined ? NaN : (dpC * 9) / 5 + 32,
                    relativeHumidity: p.relativeHumidity?.value ?? NaN,
                };
            })
            .filter((x) => x.at < cutoff && !Number.isNaN(x.dewPointF));

        // An NWS period starting at T describes T..T+1h, but the rest of this app
        // follows Open-Meteo's convention where a sample at T describes the hour
        // *ending* at T. Shift precipitation forward one slot so the luften window
        // finder sees the same interval semantics from either source.
        const hourly: WeatherHour[] = mapped.map(({ at: _at, ...rest }, i) => ({
            ...rest,
            precipitationIn: mapped[i - 1]?.precipitationIn ?? 0,
            precipitationProbability: mapped[i - 1]?.precipitationProbability ?? 0,
        }));

        return { hourly, source: "nws" };
    }
}
