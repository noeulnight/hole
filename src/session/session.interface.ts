import type { Server } from 'net';

export interface SessionStats {
  connectedAt: Date;
  lastActivityAt?: Date;
  http: {
    totalRequests: number;
    totalErrors: number;
    totalRequestBytes: number;
    totalResponseBytes: number;
    totalDurationMs: number;
  };
  tcp: {
    totalConnections: number;
    totalErrors: number;
    totalUplinkBytes: number;
    totalDownlinkBytes: number;
  };
}

export interface Forward {
  host: string;
  port: number;
  server: Server;
}

export interface Session {
  id: string;
  stats: SessionStats;
  forwards: Map<number, Forward>;
}
