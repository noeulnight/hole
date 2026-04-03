import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { SessionService } from 'src/session/session.service';
import type { SessionBodyPayload } from 'src/session/session.events';

type ForwardRequest = Request & { tunnelTarget?: string; sessionId?: string };

function normalizeHost(hostHeader?: string): string | undefined {
  if (!hostHeader) {
    return undefined;
  }

  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

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

@Injectable()
export class ForwardMiddleware implements NestMiddleware<
  ForwardRequest,
  Response
> {
  private readonly logger = new Logger(ForwardMiddleware.name);
  private readonly baseDomain: string;
  private readonly forwardTargetHost: string;
  private readonly proxy = createProxyMiddleware<ForwardRequest, Response>({
    target: 'http://127.0.0.1',
    changeOrigin: false,
    ws: true,
    xfwd: true,
    secure: false,
    router: (req) => req.tunnelTarget,
    on: {
      error: (error, req, res) => {
        const response = res as Response;
        this.logger.warn(
          `HTTP forward failed (${req.method} ${req.url}): ${error.message}`,
        );
        if (!response.headersSent) {
          response.status(502).json({ message: 'Bad gateway' });
        }
      },
    },
  });

  constructor(
    configService: ConfigService,
    private readonly sessionService: SessionService,
  ) {
    this.baseDomain = configService.get<string>('DOMAIN') ?? 'localhost';
    this.forwardTargetHost =
      configService.get<string>('FORWARD_TARGET_HOST') ?? '127.0.0.1';
  }

  use(req: ForwardRequest, res: Response, next: NextFunction) {
    const host = normalizeHost(req.headers.host);
    if (!host) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }

    const forwardHost = parseForwardHostFromHost(host, this.baseDomain);
    if (!forwardHost) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }

    const route = this.sessionService.resolveForwardHost(forwardHost);
    if (!route) {
      res.status(404).json({ message: 'Session not found' });
      return;
    }

    req.sessionId = route.session.id;
    req.tunnelTarget = `http://${formatHostForUrl(this.forwardTargetHost)}:${route.forward.port}`;
    const startedAt = Date.now();
    const requestBytes = parseContentLength(req.headers['content-length']);
    const requestContentType = parseHeader(req.headers['content-type']);
    const requestChunks: Buffer[] = [];
    const responseChunks: Buffer[] = [];
    const originalWrite = res.write.bind(res) as typeof res.write;
    const originalEnd = res.end.bind(res) as typeof res.end;
    let logged = false;

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

      this.sessionService.recordHttpTraffic(route.session.id, {
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
