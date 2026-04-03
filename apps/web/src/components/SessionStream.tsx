import { useEffect, useState } from 'react';

interface SessionSnapshot {
  sessionId: string;
  reason: string;
  at: string;
  stats: {
    connectedAt: string;
    lastActivityAt?: string;
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
  };
}

interface SessionBodyPayload {
  content: string;
  encoding: 'utf8' | 'base64';
  byteLength: number;
}

interface SessionHttpRequestEvent {
  sessionId: string;
  at: string;
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
  requestBody?: SessionBodyPayload;
  responseBody?: SessionBodyPayload;
}

interface SessionDeletedEvent {
  sessionId: string;
  reason: 'disconnected';
  at: string;
}

function formatDate(value?: string) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString();
}

function formatBytes(value: number) {
  if (value <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

export default function SessionStream({ sessionId }: { sessionId: string }) {
  const [streamError, setStreamError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [requestEvents, setRequestEvents] = useState<SessionHttpRequestEvent[]>(
    [],
  );
  const [deletedEvent, setDeletedEvent] = useState<SessionDeletedEvent | null>(
    null,
  );
  const [expandedRequestKey, setExpandedRequestKey] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setStreamError(null);
    setSnapshot(null);
    setRequestEvents([]);
    setDeletedEvent(null);
    setExpandedRequestKey(null);

    const source = new EventSource(`/api/session/${sessionId}/events`);

    const onSnapshot = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as SessionSnapshot;
      setSnapshot(payload);
    };

    const onHttpRequest = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as SessionHttpRequestEvent;
      setRequestEvents((current) => [payload, ...current].slice(0, 25));
    };

    const onDeleted = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as SessionDeletedEvent;
      setDeletedEvent(payload);
      source.close();
    };

    source.addEventListener('session.snapshot', onSnapshot as EventListener);
    source.addEventListener(
      'session.http_request',
      onHttpRequest as EventListener,
    );
    source.addEventListener('session.deleted', onDeleted as EventListener);
    source.onerror = () => {
      setStreamError('Session stream closed or session could not be found.');
      source.close();
    };

    return () => {
      source.close();
    };
  }, [sessionId]);

  return (
    <section className="dashboard-section">
      {deletedEvent ? (
        <div className="stream-meta-row">
          <p className="helper-copy">
            Session closed at {formatDate(deletedEvent.at)}.
          </p>
        </div>
      ) : null}

      {streamError ? (
        <p className="error-copy stream-error-banner">{streamError}</p>
      ) : null}

      <div className="stats-strip">
        <article className="stat-block">
          <span>Connected</span>
          <strong>{formatDate(snapshot?.stats.connectedAt)}</strong>
        </article>
        <article className="stat-block">
          <span>Last activity</span>
          <strong>{formatDate(snapshot?.stats.lastActivityAt)}</strong>
        </article>
        <article className="stat-block">
          <span>HTTP requests</span>
          <strong>{snapshot?.stats.http.totalRequests ?? 0}</strong>
        </article>
        <article className="stat-block">
          <span>TCP connections</span>
          <strong>{snapshot?.stats.tcp.totalConnections ?? 0}</strong>
        </article>
        <article className="stat-block">
          <span>Request bytes</span>
          <strong>
            {formatBytes(snapshot?.stats.http.totalRequestBytes ?? 0)}
          </strong>
        </article>
        <article className="stat-block">
          <span>Response bytes</span>
          <strong>
            {formatBytes(snapshot?.stats.http.totalResponseBytes ?? 0)}
          </strong>
        </article>
      </div>

      <div className="dashboard-stack">
        <section className="data-pane http-activity-pane">
          <div className="pane-header">
            <h2>HTTP activity</h2>
          </div>
          {requestEvents.length ? (
            <ul className="data-list request-list">
              {requestEvents.map((event, index) => {
                const requestKey = `${event.at}-${index}`;
                const isExpanded = expandedRequestKey === requestKey;

                return (
                  <li key={requestKey}>
                    <button
                      className="request-toggle"
                      type="button"
                      onClick={() =>
                        setExpandedRequestKey((current) =>
                          current === requestKey ? null : requestKey,
                        )
                      }
                    >
                      <div className="request-topline">
                        <strong>
                          {event.method} {event.path}
                        </strong>
                        <span>{event.statusCode}</span>
                      </div>
                      <div className="request-meta">
                        <span>{formatDate(event.at)}</span>
                        <span>{event.durationMs.toFixed(1)} ms</span>
                        <span>{formatBytes(event.responseBytes)}</span>
                      </div>
                    </button>

                    <div className="request-detail-grid">
                      {event.host ? (
                        <span>
                          host <strong>{event.host}</strong>
                        </span>
                      ) : null}
                      {event.ip ? (
                        <span>
                          ip <strong>{event.ip}</strong>
                        </span>
                      ) : null}
                      {event.requestContentType ? (
                        <span>
                          req type <strong>{event.requestContentType}</strong>
                        </span>
                      ) : null}
                      {event.responseContentType ? (
                        <span>
                          res type <strong>{event.responseContentType}</strong>
                        </span>
                      ) : null}
                      {event.referer ? (
                        <span>
                          referer <strong>{event.referer}</strong>
                        </span>
                      ) : null}
                      {event.userAgent ? (
                        <span className="request-user-agent">
                          ua <strong>{event.userAgent}</strong>
                        </span>
                      ) : null}
                    </div>

                    {isExpanded ? (
                      <div className="body-stack">
                        <article className="body-pane">
                          <div className="body-header">
                            <span>Request body</span>
                            <small>
                              {event.requestBody
                                ? `${event.requestBody.encoding} / ${formatBytes(event.requestBody.byteLength)}`
                                : 'empty'}
                            </small>
                          </div>
                          <pre className="body-block">
                            {event.requestBody?.content ?? ''}
                          </pre>
                        </article>
                        <article className="body-pane">
                          <div className="body-header">
                            <span>Response body</span>
                            <small>
                              {event.responseBody
                                ? `${event.responseBody.encoding} / ${formatBytes(event.responseBody.byteLength)}`
                                : 'empty'}
                            </small>
                          </div>
                          <pre className="body-block">
                            {event.responseBody?.content ?? ''}
                          </pre>
                        </article>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="empty-copy">
              Waiting for request events on the active session.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
