import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import express from 'express';
import type { ErrorRequestHandler, Express } from 'express';
import type { Config } from './config';
import { createApiRouter } from './api';
import { HttpForwarder } from './http-proxy';
import { initializeMetrics } from './metrics';
import { SessionStore } from './sessions';
import { PortPool } from './ports';
import { TunnelServer } from './ssh';
import { normalizeHost } from './utils/host';

export function createApp(
  config: Config,
  sessions: SessionStore,
  events: EventEmitter,
  forward = new HttpForwarder(config, sessions),
): Express {
  const app = express();
  app.disable('x-powered-by');
  const apiHost = normalizeHost(config.DOMAIN);
  const api = createApiRouter(sessions, events);
  app.use((req, res, next) => {
    if (apiHost && normalizeHost(req.headers.host) === apiHost) {
      api(req, res, next);
      return;
    }
    next();
  });
  // Tunnel requests must remain raw streams; do not install a body parser here.
  app.use((req, res, next) => forward.use(req, res, next));
  const onError: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    console.error(error);
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(500).json({ message: 'Internal server error' });
  };
  app.use(onError);
  return app;
}

export function createServerRuntime(config: Config) {
  initializeMetrics();
  const events = new EventEmitter();
  const sessions = new SessionStore(events);
  const ports = new PortPool(config);
  const ssh = new TunnelServer(sessions, config, ports);
  const forward = new HttpForwarder(config, sessions);
  const app = createApp(config, sessions, events, forward);
  const http = createServer(app);
  http.on('upgrade', (req, socket, head) => forward.upgrade(req, socket, head));
  const sockets = new Set<Socket>();
  http.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      await ssh.stop();
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          for (const socket of sockets) socket.destroy();
        }, 5000);
        timeout.unref();
        http.close(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    })();
    return stopping;
  };
  const start = async () => {
    try {
      await ssh.start();
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        http.once('error', onError);
        http.listen(config.HTTP_PORT, () => {
          http.off('error', onError);
          console.log(`HTTP server successfully started (${config.HTTP_PORT})`);
          resolve();
        });
      });
    } catch (error) {
      await stop();
      throw error;
    }
  };
  return { app, http, ssh, sessions, start, stop };
}
