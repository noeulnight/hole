import { ReactNode, useEffect, useState } from 'react';
import { ChevronRight, CircleAlert } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

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

function formatTime(value?: string) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
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

function getStatusClassName(statusCode: number) {
  if (statusCode >= 500) return 'text-destructive';
  if (statusCode >= 400) return 'text-muted-foreground';
  return 'text-foreground';
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '0%';
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function getAverageDuration(snapshot: SessionSnapshot | null) {
  const requests = snapshot?.stats.http.totalRequests ?? 0;
  if (!requests) return 0;
  return (snapshot?.stats.http.totalDurationMs ?? 0) / requests;
}

function getErrorRate(snapshot: SessionSnapshot | null) {
  const requests = snapshot?.stats.http.totalRequests ?? 0;
  if (!requests) return 0;
  return ((snapshot?.stats.http.totalErrors ?? 0) / requests) * 100;
}

function StatCell({
  children,
  detail,
  label,
}: {
  children: ReactNode;
  detail?: ReactNode;
  label: string;
}) {
  return (
    <div className="min-w-0 border-t py-4 sm:border-l sm:px-5 sm:[&:nth-child(-n+3)]:border-t-0 sm:[&:nth-child(3n+1)]:border-l-0">
      <div className="title-font text-xs uppercase tracking-normal text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 break-words text-lg font-semibold tracking-normal">
        {children}
      </div>
      {detail ? (
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function DetailItem({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div className={cn('min-w-0 border-t py-3', className)}>
      <div className="title-font text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-medium">{children}</div>
    </div>
  );
}

function BodyBlock({ body }: { body?: SessionBodyPayload }) {
  return (
    <pre
      className={cn(
        'max-h-80 overflow-auto whitespace-pre-wrap break-words border-t bg-background py-3 font-mono text-sm leading-6',
        !body?.content && 'text-muted-foreground',
      )}
    >
      {body?.content ?? ''}
    </pre>
  );
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
  const [selectedRequest, setSelectedRequest] =
    useState<SessionHttpRequestEvent | null>(null);

  useEffect(() => {
    setStreamError(null);
    setSnapshot(null);
    setRequestEvents([]);
    setDeletedEvent(null);
    setSelectedRequest(null);

    const source = new EventSource(`/api/session/${sessionId}/events`);

    const onSnapshot = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as SessionSnapshot;
      setSnapshot(payload);
    };

    const onHttpRequest = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as SessionHttpRequestEvent;
      setRequestEvents((current) => [payload, ...current].slice(0, 25));
      setSelectedRequest((current) => current ?? payload);
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

  const averageDuration = getAverageDuration(snapshot);
  const errorRate = getErrorRate(snapshot);
  const httpBytes =
    (snapshot?.stats.http.totalRequestBytes ?? 0) +
    (snapshot?.stats.http.totalResponseBytes ?? 0);
  const tcpBytes =
    (snapshot?.stats.tcp.totalUplinkBytes ?? 0) +
    (snapshot?.stats.tcp.totalDownlinkBytes ?? 0);
  const lastRequest = requestEvents[0];
  return (
    <section>
      {deletedEvent ? (
        <Alert className="mb-6">
          <AlertDescription>
            Session closed at {formatDate(deletedEvent.at)}.
          </AlertDescription>
        </Alert>
      ) : null}

      {streamError ? (
        <Alert className="mb-6" variant="destructive">
          <CircleAlert className="size-4" aria-hidden="true" />
          <AlertDescription>{streamError}</AlertDescription>
        </Alert>
      ) : null}

      <header className="flex items-center justify-between border-b pb-5">
        <span className="title-font text-xl font-semibold">Hole</span>
      </header>

      <section className="grid border-b sm:grid-cols-3">
        <StatCell label="Connected">
          {formatDate(snapshot?.stats.connectedAt)}
        </StatCell>
        <StatCell label="Last activity">
          {formatDate(snapshot?.stats.lastActivityAt)}
        </StatCell>
        <StatCell label="Last request">
          {lastRequest
            ? `${lastRequest.method} ${formatTime(lastRequest.at)}`
            : 'Waiting'}
        </StatCell>
        <StatCell
          detail={`${snapshot?.stats.http.totalErrors ?? 0} errors`}
          label="HTTP requests"
        >
          {snapshot?.stats.http.totalRequests ?? 0}
        </StatCell>
        <StatCell detail={`${requestEvents.length} shown`} label="Avg latency">
          {averageDuration.toFixed(1)} ms
        </StatCell>
        <StatCell
          detail={`${snapshot?.stats.tcp.totalErrors ?? 0} errors`}
          label="TCP connections"
        >
          {snapshot?.stats.tcp.totalConnections ?? 0}
        </StatCell>
        <StatCell
          detail={`${formatBytes(snapshot?.stats.http.totalRequestBytes ?? 0)} up`}
          label="HTTP bytes"
        >
          {formatBytes(httpBytes)}
        </StatCell>
        <StatCell label="TCP bytes">{formatBytes(tcpBytes)}</StatCell>
        <StatCell label="HTTP error rate">{formatPercent(errorRate)}</StatCell>
      </section>

      <section>
        {requestEvents.length ? (
          <div className="lg:flex lg:items-stretch">
            <div className="min-w-0 border-b lg:w-1/2 lg:min-w-80 lg:max-w-[75%] lg:resize-x lg:overflow-auto lg:border-r lg:border-b-0">
              <Table className="table-fixed">
                <colgroup>
                  <col className="w-[66%]" />
                  <col className="w-[14%]" />
                  <col className="w-[20%]" />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead className="title-font h-8 px-1 text-xs uppercase tracking-normal">
                      Request
                    </TableHead>
                    <TableHead className="title-font h-8 px-1 text-xs uppercase tracking-normal">
                      Status
                    </TableHead>
                    <TableHead className="title-font h-8 pr-4 pl-1 text-right text-xs uppercase tracking-normal">
                      Time
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requestEvents.map((event, index) => {
                    const isSelected = selectedRequest === event;

                    return (
                      <TableRow
                        className="cursor-pointer"
                        data-state={isSelected ? 'selected' : undefined}
                        key={`${event.at}-${index}`}
                        onClick={() => setSelectedRequest(event)}
                        onKeyDown={(keyboardEvent) => {
                          if (
                            keyboardEvent.key === 'Enter' ||
                            keyboardEvent.key === ' '
                          ) {
                            keyboardEvent.preventDefault();
                            setSelectedRequest(event);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <TableCell className="max-w-0 py-2 pr-2 pl-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <ChevronRight
                              className="size-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <div className="truncate font-mono text-sm">
                                {event.method} {event.path}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {event.host ?? formatDate(event.at)}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-1 py-2">
                          <span
                            className={cn(
                              'font-medium',
                              getStatusClassName(event.statusCode),
                            )}
                          >
                            {event.statusCode}
                          </span>
                        </TableCell>
                        <TableCell className="py-2 pr-4 pl-1 text-right text-muted-foreground">
                          {event.durationMs.toFixed(1)} ms
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="min-w-0 py-5 lg:flex-1 lg:overflow-hidden lg:pl-6">
              {selectedRequest ? (
                <div className="space-y-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {selectedRequest.method}
                        </span>
                        {selectedRequest.aborted ? (
                          <span className="text-sm font-medium text-destructive">
                            aborted
                          </span>
                        ) : null}
                      </div>
                      <h3 className="mt-3 truncate font-mono text-base font-semibold">
                        {selectedRequest.path}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatDate(selectedRequest.at)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'text-sm font-medium',
                        getStatusClassName(selectedRequest.statusCode),
                      )}
                    >
                      {selectedRequest.statusCode}
                    </span>
                  </div>

                  <div className="grid gap-x-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    <DetailItem label="Duration">
                      {selectedRequest.durationMs.toFixed(1)} ms
                    </DetailItem>
                    <DetailItem label="Response bytes">
                      {formatBytes(selectedRequest.responseBytes)}
                    </DetailItem>
                    <DetailItem label="Request bytes">
                      {formatBytes(selectedRequest.requestBytes)}
                    </DetailItem>
                    <DetailItem label="Aborted">
                      {selectedRequest.aborted ? 'Yes' : 'No'}
                    </DetailItem>
                    {selectedRequest.host ? (
                      <DetailItem label="Host">
                        {selectedRequest.host}
                      </DetailItem>
                    ) : null}
                    {selectedRequest.ip ? (
                      <DetailItem label="IP">{selectedRequest.ip}</DetailItem>
                    ) : null}
                    {selectedRequest.requestContentType ? (
                      <DetailItem label="Request type">
                        {selectedRequest.requestContentType}
                      </DetailItem>
                    ) : null}
                    {selectedRequest.responseContentType ? (
                      <DetailItem label="Response type">
                        {selectedRequest.responseContentType}
                      </DetailItem>
                    ) : null}
                    {selectedRequest.referer ? (
                      <DetailItem label="Referer">
                        {selectedRequest.referer}
                      </DetailItem>
                    ) : null}
                    {selectedRequest.userAgent ? (
                      <DetailItem
                        className="sm:col-span-2 xl:col-span-4"
                        label="UA"
                      >
                        {selectedRequest.userAgent}
                      </DetailItem>
                    ) : null}
                  </div>

                  <div className="grid gap-5 xl:grid-cols-2">
                    <article className="min-w-0">
                      <div className="mb-2 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                        <span className="title-font">Request body</span>
                        <small>
                          {selectedRequest.requestBody
                            ? `${selectedRequest.requestBody.encoding} / ${formatBytes(selectedRequest.requestBody.byteLength)}`
                            : 'empty'}
                        </small>
                      </div>
                      <BodyBlock body={selectedRequest.requestBody} />
                    </article>
                    <article className="min-w-0">
                      <div className="mb-2 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                        <span className="title-font">Response body</span>
                        <small>
                          {selectedRequest.responseBody
                            ? `${selectedRequest.responseBody.encoding} / ${formatBytes(selectedRequest.responseBody.byteLength)}`
                            : 'empty'}
                        </small>
                      </div>
                      <BodyBlock body={selectedRequest.responseBody} />
                    </article>
                  </div>
                </div>
              ) : (
                <div className="min-h-80" />
              )}
            </div>
          </div>
        ) : (
          <div className="py-6 text-sm text-muted-foreground">
            Waiting for request events on the active session.
          </div>
        )}
      </section>
    </section>
  );
}
