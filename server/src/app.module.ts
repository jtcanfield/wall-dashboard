import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { StateModule } from "./state/state.module";
import { CacheModule } from "./cache/cache.module";
import { SourcesModule } from "./sources/sources.module";
import { LuftenModule } from "./luften/luften.module";
import { RemindersModule } from "./reminders/reminders.module";

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../.env", ".env"] }),
        ScheduleModule.forRoot(),
        StateModule,
        CacheModule,
        LuftenModule,
        SourcesModule,
        RemindersModule,
    ],
})
export class AppModule {}
