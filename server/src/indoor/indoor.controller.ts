import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
import { IndoorReading, IndoorService } from "./indoor.service";

interface IndoorBody {
    tempF?: number;
    tempC?: number;
    relativeHumidity?: number;
}

/**
 * Ingest for a future networked indoor sensor (an ESP32 + BME280 would POST
 * here). Unauthenticated on purpose: the server is LAN-only on the Wyse.
 */
@Controller("api/indoor")
export class IndoorController {
    constructor(private readonly indoor: IndoorService) {}

    @Get()
    get(): IndoorReading {
        return this.indoor.current();
    }

    @Post()
    post(@Body() body: IndoorBody): IndoorReading {
        const tempF =
            body.tempF ?? (body.tempC !== undefined ? (body.tempC * 9) / 5 + 32 : undefined);
        const rh = body.relativeHumidity;
        if (typeof tempF !== "number" || Number.isNaN(tempF)) {
            throw new BadRequestException("tempF or tempC required");
        }
        if (typeof rh !== "number" || rh < 0 || rh > 100) {
            throw new BadRequestException("relativeHumidity must be 0–100");
        }
        return this.indoor.record(tempF, rh);
    }
}
