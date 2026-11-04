import type { EventEmitter } from 'node:events';
import { Router } from 'express';
import type {
  SessionDeletedPayload,
  SessionHttpRequestPayload,
  SessionSnapshotPayload,
} from './session-events';
import {
  SESSION_DELETED_EVENT,
  SESSION_HTTP_REQUEST_EVENT,
  SESSION_SNAPSHOT_EVENT,
} from './session-events';
import type { SessionStore } from './sessions';
import { sseConnectionsActiveGauge, sseEventsCounter } from './metrics';

export function createSessionRouter(
  sessions: SessionStore,
  eventEmitter: EventEmitter,
): Router {
  const router = Router();
  router.get('/:id/events', (req, res) => {
    const sessionId = req.params.id;
    const initialSnapshot = sessions.buildSnapshotEvent(sessionId, 'initial');
    if (!initialSnapshot) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    sseConnectionsActiveGauge.inc();
    let cleaned = false;
    const emitEvent = (type: string, data: object) => {
      sseEventsCounter.inc({ type });
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const onSnapshot = (payload: SessionSnapshotPayload) => {
      if (payload.sessionId === sessionId)
        emitEvent(SESSION_SNAPSHOT_EVENT, payload);
    };
    const onHttpRequest = (payload: SessionHttpRequestPayload) => {
      if (payload.sessionId === sessionId)
        emitEvent(SESSION_HTTP_REQUEST_EVENT, payload);
    };
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      sseConnectionsActiveGauge.dec();
      eventEmitter.off(SESSION_SNAPSHOT_EVENT, onSnapshot);
      eventEmitter.off(SESSION_HTTP_REQUEST_EVENT, onHttpRequest);
      eventEmitter.off(SESSION_DELETED_EVENT, onDeleted);
      res.off('close', cleanup);
    };
    const onDeleted = (payload: SessionDeletedPayload) => {
      if (payload.sessionId !== sessionId) return;
      emitEvent(SESSION_DELETED_EVENT, payload);
      cleanup();
      res.end();
    };
    eventEmitter.on(SESSION_SNAPSHOT_EVENT, onSnapshot);
    eventEmitter.on(SESSION_HTTP_REQUEST_EVENT, onHttpRequest);
    eventEmitter.on(SESSION_DELETED_EVENT, onDeleted);
    res.once('close', cleanup);
    emitEvent(SESSION_SNAPSHOT_EVENT, initialSnapshot);
  });
  return router;
}
