import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Session, SessionStats } from './session.interface';
import { randomUUID } from 'crypto';
import { Server } from 'net';
import {
  SESSION_DELETED_EVENT,
  SESSION_HTTP_REQUEST_EVENT,
  SESSION_SNAPSHOT_EVENT,
  SessionHttpRequestPayload,
  SessionSnapshotPayload,
  SessionSnapshotReason,
} from './session.events';
import {
  booleanLabel,
  forwardsActiveGauge,
  httpForwardDurationHistogram,
  httpForwardRequestsCounter,
  sessionsActiveGauge,
  sessionsCreatedCounter,
  sessionsDeletedCounter,
  tcpBytesCounter,
  tcpConnectionsCounter,
  tcpErrorsCounter,
  toStatusClass,
} from 'src/common/metrics';

interface HttpTrafficMetrics {
  method: string;
  path: string;
  host?: string;
  ip?: string;
  userAgent?: string;
  requestContentType?: string;
  responseContentType?: string;
  referer?: string;
  statusCode: number;
  requestBytes: number;
  responseBytes: number;
  durationMs: number;
  aborted: boolean;
  requestBody?: SessionHttpRequestPayload['requestBody'];
  responseBody?: SessionHttpRequestPayload['responseBody'];
}

const SNAPSHOT_EMIT_DEBOUNCE_MS = 250;

@Injectable()
export class SessionService {
  private readonly logger: Logger = new Logger(SessionService.name);
  private readonly session: Map<string, Session> = new Map();
  private readonly hostForwardTarget: Map<
    string,
    { sessionId: string; port: number }
  > = new Map();
  private readonly pendingSnapshotTimers: Map<string, NodeJS.Timeout> =
    new Map();
  private readonly pendingSnapshotReasons: Map<string, SessionSnapshotReason> =
    new Map();

  constructor(private readonly eventEmitter: EventEmitter2) {}

  public get(sessionId: string): Session | undefined {
    return this.session.get(sessionId);
  }

  public create(): Session {
    const sessionId = randomUUID();

    const session: Session = {
      id: sessionId,
      stats: {
        connectedAt: new Date(),
        lastActivityAt: new Date(),
        http: {
          totalRequests: 0,
          totalErrors: 0,
          totalRequestBytes: 0,
          totalResponseBytes: 0,
          totalDurationMs: 0,
        },
        tcp: {
          totalConnections: 0,
          totalErrors: 0,
          totalUplinkBytes: 0,
          totalDownlinkBytes: 0,
        },
      },
      forwards: new Map(),
    };

    this.session.set(sessionId, session);
    sessionsCreatedCounter.inc();
    sessionsActiveGauge.inc();
    this.logger.log(`Session created: ${sessionId}`);
    this.emitSnapshot(sessionId, 'connected');
    return session;
  }

  public delete(sessionId: string): number[] {
    const session = this.session.get(sessionId);
    if (!session) return [];

    this.clearPendingSnapshotEmit(sessionId);
    const releasedForwards = Array.from(session.forwards.values())
      .map((forward) =>
        this.removeForwardByPort(sessionId, forward.port, false),
      )
      .filter((port) => port !== undefined);

    this.session.delete(sessionId);
    sessionsDeletedCounter.inc();
    sessionsActiveGauge.dec();
    this.logger.log(`Session deleted: ${sessionId}`);
    this.eventEmitter.emit(SESSION_DELETED_EVENT, {
      sessionId,
      reason: 'disconnected',
      at: new Date().toISOString(),
    });

    return releasedForwards;
  }

  public resolveForwardHost(host: string) {
    const targetMap = this.hostForwardTarget.get(host);
    if (!targetMap) return;

    const session = this.session.get(targetMap.sessionId);
    if (!session) return;

    const forward = session.forwards.get(targetMap.port);
    if (!forward) return;

    return { session, forward };
  }

  public addForward(sessionId: string, port: number, server: Server) {
    const session = this.session.get(sessionId);
    if (!session) return;

    const host = randomUUID().replaceAll('-', '');
    const forward = session.forwards.set(port, {
      host,
      port,
      server,
    });

    this.logger.log(
      `[${sessionId}] Forward added (port: ${port}, host: ${host})`,
    );
    this.hostForwardTarget.set(host, { sessionId, port });
    forwardsActiveGauge.inc();
    this.scheduleSnapshotEmit(sessionId, 'forward_added');
    return forward;
  }

  public removeForwardByPort(
    sessionId: string,
    port: number,
    emitSnapshot = true,
  ) {
    const session = this.session.get(sessionId);
    if (!session) return;

    const forward = session.forwards.get(port);
    if (!forward) return;

    forward.server.close();
    session.forwards.delete(port);
    this.hostForwardTarget.delete(forward.host);
    forwardsActiveGauge.dec();
    this.logger.log(`[${sessionId}] Forward removed: ${port}`);
    if (emitSnapshot) {
      this.scheduleSnapshotEmit(sessionId, 'forward_removed');
    }

    return forward.port;
  }

  public recordTcpConnection(sessionId: string) {
    const updated = this.updateSessionStats(sessionId, (session) => {
      session.stats.tcp.totalConnections += 1;
    });
    if (updated) {
      tcpConnectionsCounter.inc();
      this.scheduleSnapshotEmit(sessionId, 'tcp_connection');
    }
  }

  public recordTcpTraffic(
    sessionId: string,
    direction: 'uplink' | 'downlink',
    byteLength: number,
  ) {
    const bytes = this.normalizeIncrement(byteLength);
    if (bytes <= 0) return;

    const updated = this.updateSessionStats(sessionId, (session) => {
      if (direction === 'uplink') {
        session.stats.tcp.totalUplinkBytes += bytes;
        return;
      }
      session.stats.tcp.totalDownlinkBytes += bytes;
    });
    if (updated) {
      tcpBytesCounter.inc({ direction }, bytes);
      this.scheduleSnapshotEmit(sessionId, 'tcp_traffic');
    }
  }

  public recordTcpError(sessionId: string) {
    const updated = this.updateSessionStats(sessionId, (session) => {
      session.stats.tcp.totalErrors += 1;
    });
    if (updated) {
      tcpErrorsCounter.inc();
      this.scheduleSnapshotEmit(sessionId, 'tcp_error');
    }
  }

  public recordHttpTraffic(sessionId: string, metrics: HttpTrafficMetrics) {
    const method = metrics.method || 'UNKNOWN';
    const path = metrics.path;
    const requestBytes = this.normalizeIncrement(metrics.requestBytes);
    const responseBytes = this.normalizeIncrement(metrics.responseBytes);
    const durationMs = this.normalizeIncrement(metrics.durationMs);
    const statusCode = Number.isFinite(metrics.statusCode)
      ? metrics.statusCode
      : 0;
    const aborted = Boolean(metrics.aborted);
    const statusClass = toStatusClass(statusCode);
    const abortedLabel = booleanLabel(aborted);

    const updated = this.updateSessionStats(sessionId, (session) => {
      session.stats.http.totalRequests += 1;
      session.stats.http.totalRequestBytes += requestBytes;
      session.stats.http.totalResponseBytes += responseBytes;
      session.stats.http.totalDurationMs += durationMs;

      if (aborted || statusCode >= 500) {
        session.stats.http.totalErrors += 1;
      }
    });
    if (!updated) {
      return;
    }

    httpForwardRequestsCounter.inc({
      method,
      status_class: statusClass,
      aborted: abortedLabel,
    });
    httpForwardDurationHistogram.observe(
      {
        method,
        status_class: statusClass,
        aborted: abortedLabel,
      },
      durationMs / 1000,
    );

    this.eventEmitter.emit(SESSION_HTTP_REQUEST_EVENT, {
      sessionId,
      at: new Date().toISOString(),
      method,
      path,
      host: metrics.host,
      ip: metrics.ip,
      userAgent: metrics.userAgent,
      requestContentType: metrics.requestContentType,
      responseContentType: metrics.responseContentType,
      referer: metrics.referer,
      statusCode,
      requestBytes,
      responseBytes,
      durationMs,
      aborted,
      requestBody: metrics.requestBody,
      responseBody: metrics.responseBody,
    } satisfies SessionHttpRequestPayload);
    this.scheduleSnapshotEmit(sessionId, 'http_traffic');
  }

  public buildSnapshotEvent(
    sessionId: string,
    reason: SessionSnapshotReason,
  ): SessionSnapshotPayload | undefined {
    const session = this.session.get(sessionId);
    if (!session) return;

    return {
      sessionId,
      reason,
      at: new Date().toISOString(),
      stats: this.cloneStats(session.stats),
      forwards: Array.from(session.forwards.values()).map(({ host, port }) => ({
        host,
        port,
      })),
    };
  }

  private updateSessionStats(
    sessionId: string,
    updater: (session: Session) => void,
  ): Session | undefined {
    const session = this.session.get(sessionId);
    if (!session) return;

    updater(session);
    session.stats.lastActivityAt = new Date();
    return session;
  }

  private normalizeIncrement(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value;
  }

  private scheduleSnapshotEmit(
    sessionId: string,
    reason: SessionSnapshotReason,
  ) {
    this.pendingSnapshotReasons.set(sessionId, reason);
    if (this.pendingSnapshotTimers.has(sessionId)) {
      return;
    }

    const timer = setTimeout(() => {
      this.pendingSnapshotTimers.delete(sessionId);

      const pendingReason =
        this.pendingSnapshotReasons.get(sessionId) ?? reason;
      this.pendingSnapshotReasons.delete(sessionId);
      this.emitSnapshot(sessionId, pendingReason);
    }, SNAPSHOT_EMIT_DEBOUNCE_MS);
    timer.unref?.();

    this.pendingSnapshotTimers.set(sessionId, timer);
  }

  private clearPendingSnapshotEmit(sessionId: string) {
    const timer = this.pendingSnapshotTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.pendingSnapshotTimers.delete(sessionId);
    }
    this.pendingSnapshotReasons.delete(sessionId);
  }

  private emitSnapshot(sessionId: string, reason: SessionSnapshotReason) {
    const payload = this.buildSnapshotEvent(sessionId, reason);
    if (!payload) return;

    this.eventEmitter.emit(SESSION_SNAPSHOT_EVENT, payload);
  }

  private cloneStats(stats: SessionStats): SessionStats {
    return {
      connectedAt: new Date(stats.connectedAt),
      lastActivityAt: stats.lastActivityAt
        ? new Date(stats.lastActivityAt)
        : undefined,
      http: {
        totalRequests: stats.http.totalRequests,
        totalErrors: stats.http.totalErrors,
        totalRequestBytes: stats.http.totalRequestBytes,
        totalResponseBytes: stats.http.totalResponseBytes,
        totalDurationMs: stats.http.totalDurationMs,
      },
      tcp: {
        totalConnections: stats.tcp.totalConnections,
        totalErrors: stats.tcp.totalErrors,
        totalUplinkBytes: stats.tcp.totalUplinkBytes,
        totalDownlinkBytes: stats.tcp.totalDownlinkBytes,
      },
    };
  }
}
