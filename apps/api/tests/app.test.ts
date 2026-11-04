import { EventEmitter, once } from 'node:events';
import { createServer, get } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { sseConnectionsActiveGauge } from '../src/metrics';
import {
  SESSION_HTTP_REQUEST_EVENT,
  SESSION_SNAPSHOT_EVENT,
} from '../src/session-events';
import type { SessionHttpRequestPayload } from '../src/session-events';
import { SessionStore } from '../src/sessions';

const listen = async (server: Server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
};

function nextFrame(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    const onData = (chunk: Buffer) => {
      data += chunk.toString();
      if (!data.includes('\n\n')) return;
      response.off('data', onData);
      response.off('error', reject);
      response.pause();
      resolve(data);
    };
    response.once('error', reject);
    response.on('data', onData);
    response.resume();
  });
}

describe('Express HTTP API', () => {
  const config = loadConfig({
    DOMAIN: 'example.test',
    TUNNEL_PORT_RANGE: '40000-40100',
  });
  let events: EventEmitter;
  let sessions: SessionStore;
  let app: ReturnType<typeof createApp>;
  let sessionId: string;

  beforeEach(() => {
    events = new EventEmitter();
    sessions = new SessionStore(events);
    sessionId = sessions.create().id;
    app = createApp(config, sessions, events);
  });
  afterEach(() => {
    sessions.delete(sessionId);
  });

  it('serves health and Prometheus metrics over HTTP', async () => {
    await request(app)
      .get('/health')
      .set('Host', 'example.test')
      .expect(200, { service: 'hole-api', status: 'ok' });
    const metrics = await request(app)
      .get('/metrics')
      .set('Host', 'EXAMPLE.TEST:3000')
      .expect(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
    expect(metrics.text).toContain('hole_sessions_active');
  });

  it('rejects missing sessions and unknown tunnel hosts', async () => {
    await request(app)
      .get('/session/missing/events')
      .set('Host', 'example.test')
      .expect(404);
    await request(app)
      .get('/hello')
      .set('Host', 'unknown.example.test')
      .expect(404);
    await request(app).get('/hello').set('Host', 'example.test').expect(404);
    await request(app)
      .get('/hello')
      .set('Host', 'x.example.test.evil.test')
      .expect(404);
  });

  it('serves APIs only on the base domain and forwards every tunnel path', async () => {
    const upstream = createServer((req, res) => res.end(`tunnel:${req.url}`));
    const port = await listen(upstream);
    sessions.addForward(sessionId, port, upstream);
    const host = sessions.buildSnapshotEvent(sessionId, 'initial')!.forwards[0]
      .host;
    const tunnelHost = `${host}.example.test`;

    for (const path of [
      '/status',
      '/health',
      '/metrics',
      '/session',
      '/session/example/events',
      '/.hole/health',
      '/.hole/missing',
    ]) {
      await request(app)
        .get(path)
        .set('Host', tunnelHost)
        .expect(200, `tunnel:${path}`);
    }
    await request(app)
      .get('/health')
      .set('Host', 'example.test')
      .expect(200, { service: 'hole-api', status: 'ok' });
    await request(app)
      .get('/.hole/health')
      .set('Host', 'example.test')
      .expect(404);
    await request(app)
      .get('/metrics')
      .set('Host', 'unknown.example.test')
      .expect(404);
    await request(app)
      .get(`/session/${sessionId}/events`)
      .set('Host', 'example.test.evil.test')
      .expect(404);
  });

  it.each([
    ['application/json', Buffer.from('{"hello":"world"}')],
    ['application/octet-stream', Buffer.from([0, 1, 128, 255])],
  ])(
    'forwards raw %s bodies, query strings and captures request events',
    async (contentType, body) => {
      let receivedUrl: string | undefined;
      let receivedBody = Buffer.alloc(0);
      const upstream = createServer((req, res) => {
        receivedUrl = req.url;
        req.on('data', (chunk: Buffer) => {
          receivedBody = Buffer.concat([receivedBody, chunk]);
        });
        req.on('end', () => {
          res.writeHead(201, {
            'Content-Type': 'application/octet-stream',
            'X-Upstream': 'yes',
          });
          res.end(receivedBody);
        });
      });
      const port = await listen(upstream);
      sessions.addForward(sessionId, port, upstream);
      const host = sessions.buildSnapshotEvent(sessionId, 'initial')!
        .forwards[0].host;
      const traffic = once(events, SESSION_HTTP_REQUEST_EVENT);
      const response = await request(app)
        .post('/echo?x=1')
        .set('Host', `${host}.example.test`)
        .set('Content-Type', contentType)
        .send(contentType === 'application/json' ? body.toString() : body)
        .expect(201);
      expect(response.body).toEqual(body);
      expect(response.headers['x-upstream']).toBe('yes');
      expect(receivedUrl).toBe('/echo?x=1');
      expect(receivedBody).toEqual(body);
      const [event] = (await traffic) as [SessionHttpRequestPayload];
      expect(event.sessionId).toBe(sessionId);
      expect(event.responseBody?.content).toBe(body.toString('base64'));
      expect(event.requestBody?.byteLength).toBe(body.length);
    },
  );

  it('returns 502 when the tunnel target cannot be reached', async () => {
    const upstream = createServer();
    const port = await listen(upstream);
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    sessions.addForward(sessionId, port, upstream);
    const host = sessions.buildSnapshotEvent(sessionId, 'initial')!.forwards[0]
      .host;
    await request(app)
      .get('/')
      .set('Host', `${host}.example.test`)
      .expect(502, { message: 'Bad gateway' });
  });

  it.each(['disconnect', 'delete'])(
    'streams initial and live events and cleans up on %s',
    async (action) => {
      const server = createServer(app);
      const port = await listen(server);
      let stream: IncomingMessage | undefined;
      try {
        const frame = await new Promise<string>((resolve, reject) => {
          const req = get(
            `http://127.0.0.1:${port}/session/${sessionId}/events`,
            { headers: { Host: 'example.test' } },
            (res) => {
              stream = res;
              expect(res.headers['content-type']).toContain(
                'text/event-stream',
              );
              void nextFrame(res).then(resolve, reject);
            },
          );
          req.on('error', reject);
        });
        expect(frame).toContain('event: session.snapshot');
        expect(frame).toContain(`"sessionId":"${sessionId}"`);
        expect(events.listenerCount(SESSION_SNAPSHOT_EVENT)).toBe(1);
        const live = nextFrame(stream!);
        sessions.recordHttpTraffic(sessionId, {
          method: 'GET',
          path: '/live',
          statusCode: 200,
          requestBytes: 0,
          responseBytes: 0,
          durationMs: 1,
          aborted: false,
        });
        expect(await live).toContain('event: session.http_request');
        if (action === 'delete') {
          const deleted = nextFrame(stream!);
          sessions.delete(sessionId);
          expect(await deleted).toContain('event: session.deleted');
        } else {
          stream!.destroy();
          // Wait for the server to observe the client disconnect.
          for (
            let i = 0;
            i < 50 && events.listenerCount(SESSION_SNAPSHOT_EVENT);
            i++
          ) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        expect(events.listenerCount(SESSION_SNAPSHOT_EVENT)).toBe(0);
        const metric = await sseConnectionsActiveGauge.get();
        expect(metric.values[0].value).toBe(0);
      } finally {
        stream?.destroy();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});
