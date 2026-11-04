import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

export const metricsRegistry = new Registry();

let defaultMetricsInitialized = false;

export const initializeMetrics = () => {
  if (defaultMetricsInitialized) return;
  defaultMetricsInitialized = true;
  collectDefaultMetrics({ register: metricsRegistry, prefix: 'hole_' });
};

export const sessionsActiveGauge = new Gauge({
  name: 'hole_sessions_active',
  help: 'Current number of active sessions',
  registers: [metricsRegistry],
});

export const sessionsCreatedCounter = new Counter({
  name: 'hole_sessions_created_total',
  help: 'Total number of created sessions',
  registers: [metricsRegistry],
});

export const sessionsDeletedCounter = new Counter({
  name: 'hole_sessions_deleted_total',
  help: 'Total number of deleted sessions',
  registers: [metricsRegistry],
});

export const forwardsActiveGauge = new Gauge({
  name: 'hole_forwards_active',
  help: 'Current number of active forwards',
  registers: [metricsRegistry],
});

export const forwardRequestsCounter = new Counter({
  name: 'hole_forward_requests_total',
  help: 'Total number of SSH tcpip-forward requests',
  labelNames: ['result'] as const,
  registers: [metricsRegistry],
});

export const portPoolFreeGauge = new Gauge({
  name: 'hole_port_pool_free',
  help: 'Number of free ports in the tunnel port pool',
  registers: [metricsRegistry],
});

export const portPoolUsedGauge = new Gauge({
  name: 'hole_port_pool_used',
  help: 'Number of used ports in the tunnel port pool',
  registers: [metricsRegistry],
});

export const portAcquireFailCounter = new Counter({
  name: 'hole_port_acquire_fail_total',
  help: 'Total number of failed port acquire attempts',
  registers: [metricsRegistry],
});

export const sshAuthAttemptsCounter = new Counter({
  name: 'hole_ssh_auth_attempts_total',
  help: 'Total number of SSH authentication attempts',
  labelNames: ['mode', 'method', 'result'] as const,
  registers: [metricsRegistry],
});

export const tcpConnectionsCounter = new Counter({
  name: 'hole_tcp_connections_total',
  help: 'Total number of TCP tunnel connections',
  registers: [metricsRegistry],
});

export const tcpErrorsCounter = new Counter({
  name: 'hole_tcp_errors_total',
  help: 'Total number of TCP tunnel errors',
  registers: [metricsRegistry],
});

export const tcpBytesCounter = new Counter({
  name: 'hole_tcp_bytes_total',
  help: 'Total number of bytes relayed through TCP tunnels',
  labelNames: ['direction'] as const,
  registers: [metricsRegistry],
});

export const httpForwardRequestsCounter = new Counter({
  name: 'hole_http_forward_requests_total',
  help: 'Total number of forwarded HTTP requests',
  labelNames: ['method', 'status_class', 'aborted'] as const,
  registers: [metricsRegistry],
});

export const httpForwardDurationHistogram = new Histogram({
  name: 'hole_http_forward_duration_seconds',
  help: 'Duration of forwarded HTTP requests in seconds',
  labelNames: ['method', 'status_class', 'aborted'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [metricsRegistry],
});

export const sseConnectionsActiveGauge = new Gauge({
  name: 'hole_sse_connections_active',
  help: 'Current number of active SSE connections',
  registers: [metricsRegistry],
});

export const sseEventsCounter = new Counter({
  name: 'hole_sse_events_total',
  help: 'Total number of emitted SSE events',
  labelNames: ['type'] as const,
  registers: [metricsRegistry],
});

export const toStatusClass = (statusCode: number): string => {
  if (!Number.isFinite(statusCode)) return 'other';
  if (statusCode >= 100 && statusCode < 200) return '1xx';
  if (statusCode >= 200 && statusCode < 300) return '2xx';
  if (statusCode >= 300 && statusCode < 400) return '3xx';
  if (statusCode >= 400 && statusCode < 500) return '4xx';
  if (statusCode >= 500 && statusCode < 600) return '5xx';
  return 'other';
};

export const booleanLabel = (value: boolean): 'true' | 'false' =>
  value ? 'true' : 'false';
