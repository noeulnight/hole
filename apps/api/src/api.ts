import type { EventEmitter } from 'node:events';
import { Router } from 'express';
import { metricsRegistry } from './metrics';
import { createSessionRouter } from './session-stream';
import type { SessionStore } from './sessions';

export function createApiRouter(
  sessions: SessionStore,
  events: EventEmitter,
): Router {
  const api = Router();
  api.get('/health', (_req, res) => {
    res.json({ service: 'hole-api', status: 'ok' });
  });
  api.get('/metrics', async (_req, res) => {
    res.set('Content-Type', metricsRegistry.contentType);
    res.send(await metricsRegistry.metrics());
  });
  api.use('/session', createSessionRouter(sessions, events));
  api.use((_req, res) => {
    res.status(404).json({ message: 'Not found' });
  });
  return api;
}
