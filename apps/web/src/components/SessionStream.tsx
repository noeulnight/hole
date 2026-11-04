import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ChevronRight, CircleAlert, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import SessionTrafficCharts from '@/components/SessionTrafficCharts';

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
  requestHttpVersion?: string;
  responseHttpVersion?: string;
  statusMessage?: string;
  requestHeaders?: string[];
  responseHeaders?: string[];
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
    <div className="min-w-0 bg-background px-4 py-4 sm:px-5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1.5 font-mono text-2xl font-medium tracking-tight tabular-nums">
        {children}
      </div>
      {detail ? (
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
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
    <div className={cn('min-w-0 border-t py-2.5', className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-medium">{children}</div>
    </div>
  );
}

function RawHttpBlock({
  startLine,
  headers,
  body,
}: {
  startLine: string;
  headers?: string[];
  body?: SessionBodyPayload;
}) {
  const lines = [startLine];
  const rawHeaders = headers ?? [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    lines.push(`${rawHeaders[index]}: ${rawHeaders[index + 1]}`);
  }
  return (
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 font-mono text-xs leading-5">
      {[...lines, '', body?.content ?? ''].join('\r\n')}
    </pre>
  );
}

export default function SessionStream({ sessionId }: { sessionId: string }) {
  const [connectionAttempt, setConnectionAttempt] = useState(0);
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

    const source = new EventSource(
      `/api/session/${encodeURIComponent(sessionId)}/events`,
    );

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
  }, [sessionId, connectionAttempt]);

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
    <section className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Hole</h1>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span>
          Connected{' '}
          <span className="text-foreground">
            {formatDate(snapshot?.stats.connectedAt)}
          </span>
        </span>
        <span>
          Last activity{' '}
          <span className="text-foreground">
            {formatTime(snapshot?.stats.lastActivityAt)}
          </span>
        </span>
        <span>
          TCP{' '}
          <span className="font-mono text-foreground">
            {snapshot?.stats.tcp.totalConnections ?? 0} connections ·{' '}
            {formatBytes(tcpBytes)} · {snapshot?.stats.tcp.totalErrors ?? 0}{' '}
            errors
          </span>
        </span>
        <span>
          Last request{' '}
          <span className="text-foreground">
            {lastRequest
              ? `${lastRequest.method} ${formatTime(lastRequest.at)}`
              : 'Waiting'}
          </span>
        </span>
      </div>

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
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{streamError}</span>
            {!deletedEvent ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConnectionAttempt((value) => value + 1)}
              >
                <RefreshCw /> Reconnect
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <section
        aria-label="Session statistics"
        className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4"
      >
        <StatCell
          detail={`${snapshot?.stats.http.totalErrors ?? 0} errors`}
          label="HTTP requests"
        >
          {snapshot?.stats.http.totalRequests ?? 0}
        </StatCell>
        <StatCell label="Avg latency">
          {averageDuration.toFixed(1)}
          <span className="ml-1 text-sm text-muted-foreground">ms</span>
        </StatCell>
        <StatCell
          detail={`${formatBytes(snapshot?.stats.http.totalRequestBytes ?? 0)} sent`}
          label="HTTP transfer"
        >
          {formatBytes(httpBytes)}
        </StatCell>
        <StatCell label="Error rate">{formatPercent(errorRate)}</StatCell>
      </section>
      <SessionTrafficCharts
        key={`${sessionId}-${connectionAttempt}`}
        totals={snapshot?.stats.http}
        active={Boolean(snapshot && !deletedEvent && !streamError)}
      />

      <Card aria-label="Requests" className="overflow-hidden shadow-none">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <CardTitle className="text-sm">Requests</CardTitle>
          <span className="text-xs text-muted-foreground">
            {requestEvents.length} / {snapshot?.stats.http.totalRequests ?? 0}
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <div className="lg:flex lg:h-[640px] lg:items-stretch lg:overflow-hidden">
            <div className="max-h-96 min-h-64 min-w-0 overflow-auto border-b lg:h-full lg:max-h-none lg:w-[42%] lg:min-w-80 lg:overscroll-contain lg:border-r lg:border-b-0">
              <Table className="table-fixed">
                <colgroup>
                  <col className="w-[66%]" />
                  <col className="w-[14%]" />
                  <col className="w-[20%]" />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9 bg-muted/30 px-4 text-[11px] font-medium">
                      Request
                    </TableHead>
                    <TableHead className="h-9 bg-muted/30 px-4 text-[11px] font-medium">
                      Status
                    </TableHead>
                    <TableHead className="h-9 bg-muted/30 pr-4 pl-1 text-right text-[11px] font-medium">
                      Time
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!requestEvents.length ? (
                    <TableRow>
                      <TableCell colSpan={3} className="h-64 px-6 text-center">
                        <p className="text-sm font-medium">
                          {deletedEvent
                            ? 'Session disconnected'
                            : streamError
                              ? 'Session unavailable'
                              : 'Waiting for requests'}
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : null}
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
                        <TableCell className="max-w-0 py-2.5 pr-2 pl-4">
                          <div className="flex min-w-0 items-center gap-2">
                            <ChevronRight
                              className="size-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <div className="truncate font-mono text-xs">
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
                        <TableCell className="py-2 pr-4 pl-1 text-right font-mono text-xs text-muted-foreground">
                          {event.durationMs.toFixed(1)} ms
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="min-w-0 px-4 py-4 lg:h-full lg:min-h-0 lg:flex-1 lg:overflow-x-hidden lg:overflow-y-auto lg:overscroll-contain lg:px-5">
              {selectedRequest ? (
                <div className="space-y-4">
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
                      <h3 className="mt-2 break-all font-mono text-sm font-medium">
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

                  <div className="grid grid-cols-2 gap-x-4 text-xs xl:grid-cols-4">
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
                    <DetailItem label="Peer IP">
                      {selectedRequest.ip ?? 'Not captured'}
                    </DetailItem>
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

                  <div className="grid gap-4">
                    <article className="min-w-0">
                      <div className="mb-2 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                        <span className="font-medium">Request</span>
                        <small>
                          {selectedRequest.requestBody
                            ? `${selectedRequest.requestBody.encoding} / ${formatBytes(selectedRequest.requestBody.byteLength)}`
                            : 'empty'}
                        </small>
                      </div>
                      <RawHttpBlock
                        startLine={`${selectedRequest.method} ${selectedRequest.path}${selectedRequest.requestHttpVersion ? ` HTTP/${selectedRequest.requestHttpVersion}` : ''}`}
                        headers={selectedRequest.requestHeaders}
                        body={selectedRequest.requestBody}
                      />
                    </article>
                    <article className="min-w-0">
                      <div className="mb-2 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                        <span className="font-medium">
                          {selectedRequest.responseHttpVersion
                            ? 'Response · upstream'
                            : 'Response'}
                        </span>
                        <small>
                          {selectedRequest.responseBody
                            ? `${selectedRequest.responseBody.encoding} / ${formatBytes(selectedRequest.responseBody.byteLength)}`
                            : 'empty'}
                        </small>
                      </div>
                      <RawHttpBlock
                        startLine={`${selectedRequest.responseHttpVersion ? `HTTP/${selectedRequest.responseHttpVersion} ` : ''}${selectedRequest.statusCode}${selectedRequest.statusMessage ? ` ${selectedRequest.statusMessage}` : ''}`}
                        headers={selectedRequest.responseHeaders}
                        body={selectedRequest.responseBody}
                      />
                    </article>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-center lg:min-h-[400px]">
                  <ChevronRight
                    className="size-5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <p className="text-xs text-muted-foreground">
                    Select a request
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
