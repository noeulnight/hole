import type { Config } from './config';
import { ServerResponse } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import type { NextFunction, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { normalizeHost } from './utils/host';
import type { SessionStore } from './sessions';
import type { SessionBodyPayload } from './session-events';

type ForwardRequest = IncomingMessage & {
  tunnelTarget?: string;
  sessionId?: string;
};

function parseContentLength(
  value: number | string | string[] | undefined,
): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }

  if (typeof raw !== 'string') {
    return 0;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function parseHeader(
  value: number | string | string[] | undefined,
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return undefined;
  }

  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isTextLikeContentType(contentType?: string): boolean {
  if (!contentType) {
    return true;
  }

  const normalized = contentType.toLowerCase();
  return (
    normalized.startsWith('text/') ||
    normalized.includes('json') ||
    normalized.includes('xml') ||
    normalized.includes('javascript') ||
    normalized.includes('x-www-form-urlencoded') ||
    normalized.includes('svg')
  );
}

function captureChunk(
  chunk: unknown,
  encoding: BufferEncoding | undefined,
  chunks: Buffer[],
) {
  if (chunk === undefined || chunk === null) {
    return;
  }

  if (Buffer.isBuffer(chunk)) {
    chunks.push(chunk);
    return;
  }

  if (typeof chunk === 'string') {
    chunks.push(Buffer.from(chunk, encoding));
    return;
  }

  if (chunk instanceof Uint8Array) {
    chunks.push(Buffer.from(chunk));
  }
}

function serializeBody(
  chunks: Buffer[],
  contentType?: string,
): SessionBodyPayload | undefined {
  if (chunks.length === 0) {
    return undefined;
  }

  const body = Buffer.concat(chunks);
  if (body.length === 0) {
    return undefined;
  }

  if (isTextLikeContentType(contentType)) {
    return {
      content: body.toString('utf8'),
      encoding: 'utf8',
      byteLength: body.length,
    };
  }

  return {
    content: body.toString('base64'),
    encoding: 'base64',
    byteLength: body.length,
  };
}

function parseForwardHostFromHost(
  host: string,
  baseDomain: string,
): string | undefined {
  if (!host) {
    return undefined;
  }

  const normalizedBaseDomain = baseDomain.toLowerCase().replace(/^\./, '');
  const suffix = `.${normalizedBaseDomain}`;

  if (!host.endsWith(suffix)) {
    return undefined;
  }

  const forwardHost = host.slice(0, -suffix.length);
  if (!forwardHost || forwardHost.includes('.')) {
    return undefined;
  }

  return forwardHost;
}

function formatHostForUrl(host: string): string {
  if (host.includes(':') && !host.startsWith('[') && !host.endsWith(']')) {
    return `[${host}]`;
  }
  return host;
}

export class HttpForwarder {
  private readonly logger = console;
  private readonly baseDomain: string;
  private readonly forwardTargetHost: string;
  private readonly proxy = createProxyMiddleware<ForwardRequest, Response>({
    target: 'http://127.0.0.1',
    changeOrigin: false,
    // The HTTP server routes upgrades explicitly, including the first request.
    ws: false,
    xfwd: true,
    secure: false,
    router: (req) => req.tunnelTarget,
    on: {
      error: (error, req, res) => {
        this.logger.warn(
          `HTTP forward failed (${req.method} ${req.url}): ${error.message}`,
        );
        if (!(res instanceof ServerResponse)) {
          res.destroy();
          return;
        }
        if (res.headersSent) {
          res.destroy(error);
          return;
        }
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Bad gateway' }));
      },
    },
  });

  constructor(
    config: Config,
    private readonly sessions: SessionStore,
  ) {
    this.baseDomain = config.DOMAIN;
    this.forwardTargetHost = config.FORWARD_TARGET_HOST;
  }

  private resolveRoute(req: ForwardRequest) {
    const host = normalizeHost(req.headers.host);
    if (!host) return;

    const forwardHost = parseForwardHostFromHost(host, this.baseDomain);
    if (!forwardHost) return;

    const route = this.sessions.resolveForwardHost(forwardHost);
    if (!route) return;

    req.sessionId = route.session.id;
    req.tunnelTarget = `http://${formatHostForUrl(this.forwardTargetHost)}:${route.forward.port}`;
    return { ...route, host };
  }

  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    socket.once('error', () => socket.destroy());
    if (!this.resolveRoute(req)) {
      socket.end(
        'HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
      return;
    }
    this.proxy.upgrade(req, socket as Socket, head);
  }

  use(req: Request, res: Response, next: NextFunction) {
    const route = this.resolveRoute(req);
    if (!route) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }
    const { host } = route;
    const startedAt = Date.now();
    const requestBytes = parseContentLength(req.headers['content-length']);
    const requestContentType = parseHeader(req.headers['content-type']);
    const requestChunks: Buffer[] = [];
    const responseChunks: Buffer[] = [];
    const originalWrite = res.write.bind(res) as typeof res.write;
    const originalEnd = res.end.bind(res) as typeof res.end;
    let logged = false;

    // Keep the stream paused until the proxy attaches its pipe after async routing.
    req.pause();
    req.on('data', (chunk) => {
      captureChunk(chunk, undefined, requestChunks);
    });

    res.write = ((
      chunk: unknown,
      encoding?: BufferEncoding,
      callback?: () => void,
    ) => {
      captureChunk(chunk, encoding, responseChunks);
      return originalWrite(
        chunk as never,
        encoding as never,
        callback as never,
      );
    }) as typeof res.write;

    res.end = ((
      chunk?: unknown,
      encoding?: BufferEncoding,
      callback?: () => void,
    ) => {
      captureChunk(chunk, encoding, responseChunks);
      return originalEnd(chunk as never, encoding as never, callback as never);
    }) as typeof res.end;

    const logTraffic = (trigger: 'finish' | 'close') => {
      if (logged) return;
      logged = true;

      const durationMs = Date.now() - startedAt;
      const responseBytes = parseContentLength(res.getHeader('content-length'));
      const responseContentType = parseHeader(res.getHeader('content-type'));
      const isAborted = trigger === 'close' && !res.writableFinished;

      this.sessions.recordHttpTraffic(route.session.id, {
        method: req.method,
        path: req.originalUrl ?? req.url,
        host,
        ip: req.ip,
        userAgent: parseHeader(req.headers['user-agent']),
        requestContentType,
        responseContentType,
        referer: parseHeader(req.headers.referer),
        statusCode: res.statusCode,
        requestBytes,
        responseBytes,
        durationMs,
        aborted: isAborted,
        requestBody: serializeBody(requestChunks, requestContentType),
        responseBody: serializeBody(responseChunks, responseContentType),
      });

      this.logger.log(
        `[${route.session.id}] HTTP ${req.method} ${req.originalUrl ?? req.url} -> ${res.statusCode} (${durationMs}ms, req=${requestBytes}B, res=${responseBytes}B${isAborted ? ', aborted' : ''})`,
      );
    };

    res.once('finish', () => logTraffic('finish'));
    res.once('close', () => logTraffic('close'));

    void this.proxy(req, res, next);
  }
}
