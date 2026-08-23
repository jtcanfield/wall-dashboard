import { Controller, Get, MessageEvent, Sse } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { StateService } from './state.service';
import { DashboardState } from '../shared';

@Controller('api')
export class StreamController {
  constructor(private readonly state: StateService) {}

  /**
   * SSE rather than WebSockets specifically because EventSource has automatic
   * reconnect with backoff built into the browser. For an unattended display
   * that reconnect behaviour is the whole point.
   */
  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return this.state.stream.pipe(
      map((state: DashboardState): MessageEvent => ({ data: state })),
    );
  }

  @Get('health')
  health(): { ok: true; generatedAt: string } {
    return { ok: true, generatedAt: this.state.current.generatedAt };
  }
}
