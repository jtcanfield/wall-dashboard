import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { dewPointF } from "../luften/dewpoint";

export interface IndoorReading {
    tempF: number;
    relativeHumidity: number;
    dewPointF: number;
    source: "assumed" | "sensor";
    at: string;
}

/** A sensor reading older than this falls back to the assumed constants. */
const SENSOR_STALE_MS = 30 * 60_000;

/**
 * Indoor conditions for the luften calculation.
 *
 * Decision 3 landed on (a): assume 70°F / 50% RH, zero hardware, most of the
 * value. The interface is here so that swapping in a real networked sensor
 * later is a POST to /api/indoor and nothing in the luften logic changes.
 */
@Injectable()
export class IndoorService {
    private readonly log = new Logger(IndoorService.name);
    private latest: IndoorReading | null = null;

    constructor(private readonly config: ConfigService) {}

    record(tempF: number, relativeHumidity: number): IndoorReading {
        this.latest = {
            tempF,
            relativeHumidity,
            dewPointF: dewPointF(tempF, relativeHumidity),
            source: "sensor",
            at: new Date().toISOString(),
        };
        this.log.log(`Indoor sensor: ${tempF}°F / ${relativeHumidity}% RH`);
        return this.latest;
    }

    current(): IndoorReading {
        if (this.latest && Date.now() - Date.parse(this.latest.at) < SENSOR_STALE_MS) {
            return this.latest;
        }
        const tempF = this.config.get<number>("INDOOR_TEMP_F", 70);
        const rh = this.config.get<number>("INDOOR_RH", 50);
        return {
            tempF,
            relativeHumidity: rh,
            dewPointF: dewPointF(tempF, rh),
            source: "assumed",
            at: new Date().toISOString(),
        };
    }
}
