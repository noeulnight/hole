import type { SessionStats } from './session.interface';

export const SESSION_SNAPSHOT_EVENT = 'session.snapshot';
export const SESSION_HTTP_REQUEST_EVENT = 'session.http_request';
export const SESSION_DELETED_EVENT = 'session.deleted';

export type SessionSnapshotReason =
  | 'initial'
  | 'connected'
  | 'forward_added'
  | 'forward_removed'
  | 'http_traffic'
  | 'tcp_connection'
  | 'tcp_traffic'
  | 'tcp_error';

export interface SessionForwardSnapshot {
  host: string;
  port: number;
}

export interface SessionSnapshotPayload {
  sessionId: string;
  reason: SessionSnapshotReason;
  at: string;
  stats: SessionStats;
  forwards: SessionForwardSnapshot[];
}

export interface SessionHttpRequestPayload {
  sessionId: string;
  at: string;
  method: string;
  path: string;
  statusCode: number;
  requestBytes: number;
  responseBytes: number;
  durationMs: number;
  aborted: boolean;
}

export interface SessionDeletedPayload {
  sessionId: string;
  reason: 'disconnected';
  at: string;
}

export type SessionEventPayload =
  | SessionSnapshotPayload
  | SessionHttpRequestPayload
  | SessionDeletedPayload;
