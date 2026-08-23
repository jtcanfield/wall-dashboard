import { Module } from "@nestjs/common";
import { LuftenService } from "./luften.service";
import { IndoorService } from "../indoor/indoor.service";
import { IndoorController } from "../indoor/indoor.controller";

@Module({
    controllers: [IndoorController],
    providers: [LuftenService, IndoorService],
    exports: [IndoorService],
})
export class LuftenModule {}
