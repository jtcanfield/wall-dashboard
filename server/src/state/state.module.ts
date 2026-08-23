import { Global, Module } from '@nestjs/common';
import { StateService } from './state.service';
import { StreamController } from './stream.controller';

@Global()
@Module({
  controllers: [StreamController],
  providers: [StateService],
  exports: [StateService],
})
export class StateModule {}
