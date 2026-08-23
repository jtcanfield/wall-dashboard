import { Module } from "@nestjs/common";
import { WeatherService } from "./weather/weather.service";
import { FxService } from "./fx/fx.service";
import { NewsService } from "./news/news.service";
import { TranslateService } from "./news/translate.service";
import { TwitchService } from "./twitch/twitch.service";
import { CollectionService } from "./collection/collection.service";

/**
 * Six data sources, one module each, all of them talking only to the cache and
 * the state service. Sources never talk to each other.
 */
@Module({
    providers: [
        WeatherService,
        FxService,
        NewsService,
        TranslateService,
        TwitchService,
        CollectionService,
    ],
})
export class SourcesModule {}
