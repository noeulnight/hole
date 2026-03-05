import {
  Controller,
  MessageEvent,
  NotFoundException,
  Param,
  Req,
  Sse,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import {
  SESSION_DELETED_EVENT,
  SESSION_HTTP_REQUEST_EVENT,
  SESSION_SNAPSHOT_EVENT,
  SessionDeletedPayload,
  SessionHttpRequestPayload,
  SessionSnapshotPayload,
} from './session.events';
import { SessionService } from './session.service';
import {
  sseConnectionsActiveGauge,
  sseEventsCounter,
} from 'src/common/metrics';

@Controller('session')
export class SessionController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Sse(':id/events')
  events(
    @Param('id') sessionId: string,
    @Req() req: Request,
  ): Observable<MessageEvent> {
    const initialSnapshot = this.sessionService.buildSnapshotEvent(
      sessionId,
      'initial',
    );
    if (!initialSnapshot) {
      throw new NotFoundException('Session not found');
    }

    return new Observable<MessageEvent>((subscriber) => {
      let cleaned = false;
      sseConnectionsActiveGauge.inc();

      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        sseConnectionsActiveGauge.dec();

        this.eventEmitter.off(SESSION_SNAPSHOT_EVENT, onSnapshot);
        this.eventEmitter.off(SESSION_HTTP_REQUEST_EVENT, onHttpRequest);
        this.eventEmitter.off(SESSION_DELETED_EVENT, onDeleted);
        req.off?.('close', onClose);
      };

      const emitEvent = (type: string, data: string | object) => {
        sseEventsCounter.inc({ type });
        subscriber.next({ type, data });
      };

      const onSnapshot = (payload: SessionSnapshotPayload) => {
        if (payload.sessionId !== sessionId) return;
        emitEvent(SESSION_SNAPSHOT_EVENT, payload);
      };

      const onHttpRequest = (payload: SessionHttpRequestPayload) => {
        if (payload.sessionId !== sessionId) return;
        emitEvent(SESSION_HTTP_REQUEST_EVENT, payload);
      };

      const onDeleted = (payload: SessionDeletedPayload) => {
        if (payload.sessionId !== sessionId) return;
        emitEvent(SESSION_DELETED_EVENT, payload);
        cleanup();
        subscriber.complete();
      };

      const onClose = () => {
        cleanup();
        subscriber.complete();
      };

      this.eventEmitter.on(SESSION_SNAPSHOT_EVENT, onSnapshot);
      this.eventEmitter.on(SESSION_HTTP_REQUEST_EVENT, onHttpRequest);
      this.eventEmitter.on(SESSION_DELETED_EVENT, onDeleted);
      req.on('close', onClose);

      emitEvent(SESSION_SNAPSHOT_EVENT, initialSnapshot);

      return cleanup;
    });
  }
}
