import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';

@Module({ providers: [RemindersService] })
export class RemindersModule {}
