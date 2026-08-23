import { Injectable, OnModuleInit } from '@nestjs/common';
import { StateService } from '../state/state.service';
import { IndoorService } from '../indoor/indoor.service';
import { buildDays } from './luften';
import { LuftenState } from '../shared';

/**
 * Luften is derived, not fetched, so it hangs off the state stream rather than
 * having weather call it. That keeps the rule that sources never talk to each
 * other, and means any future path that updates weather gets luften for free.
 */
@Injectable()
export class LuftenService implements OnModuleInit {
  private signature: string | null = null;

  constructor(
    private readonly state: StateService,
    private readonly indoor: IndoorService,
  ) {}

  onModuleInit(): void {
    this.state.stream.subscribe(() => this.recompute());
  }

  /**
   * Pushing into state re-enters this subscriber, so the signature guard is
   * what terminates the loop: a recompute that changes nothing pushes nothing.
   */
  recompute(): void {
    const weather = this.state.current.weather.data;
    const indoor = this.indoor.current();

    if (!weather || weather.hourly.length === 0) {
      if (this.signature !== null) {
        this.signature = null;
        this.state.setLuften(null);
      }
      return;
    }

    const signature = [
      this.state.current.weather.fetchedAt,
      indoor.dewPointF.toFixed(2),
      indoor.source,
    ].join('|');
    if (signature === this.signature) return;
    this.signature = signature;

    const days = buildDays(weather.hourly, indoor.dewPointF);
    const [today, ...rest] = days;
    if (!today) return;

    const luften: LuftenState = {
      indoorTempF: indoor.tempF,
      indoorRelativeHumidity: indoor.relativeHumidity,
      indoorDewPointF: indoor.dewPointF,
      indoorSource: indoor.source,
      today,
      lookahead: rest.slice(0, 3),
    };
    this.state.setLuften(luften);
  }
}
