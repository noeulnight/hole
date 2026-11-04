import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import {
  connect as connectTcp,
  createServer as createTcpServer,
} from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'ssh2';
import type { ConnectConfig } from 'ssh2';
import request from 'supertest';
import { WebSocket, WebSocketServer } from 'ws';
import { createServerRuntime } from '../src/app';
import { loadConfig } from '../src/config';

async function listen(server: Server, port = 0): Promise<number> {
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}
const close = (server: Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()));

async function reserveTunnelRange() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const first = createTcpServer();
    const second = createTcpServer();
    try {
      // Keep tunnel ports outside the ephemeral range used by parallel HTTP tests.
      const port = await listen(
        first,
        20000 + 2 * Math.floor(Math.random() * 4000),
      );
      await listen(second, port + 1);
      return {
        range: `${port}-${port + 1}`,
        release: () => Promise.all([close(first), close(second)]),
      };
    } catch (error) {
      await close(first);
      await close(second);
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('Unable to reserve two adjacent tunnel ports');
}

async function connect(
  client: Client,
  port: number,
  options: Partial<ConnectConfig> = {},
) {
  const ready = once(client, 'ready');
  client.connect({
    host: '127.0.0.1',
    port,
    username: 'test',
    readyTimeout: 3000,
    ...options,
  });
  await ready;
}

async function sessionInfo(client: Client): Promise<string> {
  return new Promise((resolve, reject) => {
    client.shell((error, stream) => {
      if (error) return reject(error);
      let text = '';
      stream.on('data', (chunk: Buffer) => {
        text += chunk.toString();
        const match = text.match(/sessionId: ([0-9a-f-]+)/);
        if (match) resolve(match[1]);
      });
      stream.on('error', reject);
    });
  });
}

describe('SSH tunnel through the Express server', () => {
  let directory: string;
  let runtime: ReturnType<typeof createServerRuntime>;
  const clients = new Set<Client>();
  const localSockets = new Set<Socket>();
  let upstream: ReturnType<typeof createHttpServer> | undefined;
  let localPort: number;
  let websocketServer: WebSocketServer;
  const websockets = new Set<WebSocket>();

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'hole-test-'));
    const reservation = await reserveTunnelRange();
    try {
      upstream = createHttpServer((req, res) => {
        res.end(`local:${req.url}`);
      });
      websocketServer = new WebSocketServer({ server: upstream });
      websocketServer.on('connection', (socket, req) => {
        socket.send(`server:${req.url}`);
        socket.on('message', (data, isBinary) =>
          socket.send(data, { binary: isBinary }),
        );
      });
      localPort = await listen(upstream);
      runtime = createServerRuntime(
        loadConfig({
          DOMAIN: 'example.test',
          HTTP_PORT: '0',
          SSH_PORT: '0',
          SSH_HOST: '127.0.0.1',
          SSH_HOST_KEY_PATH: join(directory, 'host.key'),
          TUNNEL_PORT_RANGE: reservation.range,
          SSH_AUTH_MODE: 'password',
          SSH_AUTH_USERNAME: 'test',
          SSH_AUTH_PASSWORD: 'secret',
        }),
      );
      await runtime.start();
    } finally {
      await reservation.release();
    }
  });
  afterEach(async () => {
    for (const socket of websockets) socket.terminate();
    websockets.clear();
    for (const socket of websocketServer?.clients ?? []) socket.terminate();
    if (websocketServer)
      await new Promise<void>((resolve) =>
        websocketServer.close(() => resolve()),
      );
    for (const client of clients) client.destroy();
    clients.clear();
    for (const socket of localSockets) socket.destroy();
    localSockets.clear();
    await runtime?.stop();
    if (upstream) await close(upstream);
    upstream = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  async function openTunnel() {
    const client = new Client();
    clients.add(client);
    client.on('tcp connection', (_info, accept) => {
      const channel = accept();
      const socket = connectTcp(localPort, '127.0.0.1');
      localSockets.add(socket);
      socket.on('error', () => channel.destroy());
      channel.on('error', () => socket.destroy());
      socket.on('close', () => localSockets.delete(socket));
      channel.pipe(socket).pipe(channel);
    });
    await connect(client, (runtime.ssh.address() as AddressInfo).port, {
      password: 'secret',
    });
    const forwardedPort = await new Promise<number>((resolve, reject) => {
      client.forwardIn('localhost', 0, (error, port) =>
        error ? reject(error) : resolve(port),
      );
    });
    const sessionId = await sessionInfo(client);
    const snapshot = runtime.sessions.buildSnapshotEvent(sessionId, 'initial')!;
    return { client, forwardedPort, sessionId, snapshot };
  }

  function openWebSocket(host: string, path = '/ws?probe=1') {
    const ws = new WebSocket(
      `ws://127.0.0.1:${(runtime.http.address() as AddressInfo).port}${path}`,
      {
        headers: { Host: host },
        handshakeTimeout: 1500,
      },
    );
    websockets.add(ws);
    return ws;
  }

  it('rejects invalid SSH credentials', async () => {
    const client = new Client();
    clients.add(client);
    await expect(
      connect(client, (runtime.ssh.address() as AddressInfo).port, {
        password: 'wrong',
      }),
    ).rejects.toThrow('authentication');
  });

  it('opens a real remote forward, proxies HTTP and TCP, then closes the active session', async () => {
    const { client, forwardedPort, sessionId, snapshot } = await openTunnel();
    expect(snapshot.forwards[0].port).toBe(forwardedPort);
    await request(runtime.http)
      .get('/through-ssh?x=1')
      .set('Host', `${snapshot.forwards[0].host}.example.test`)
      .expect(200, 'local:/through-ssh?x=1');
    const rawResponse = await new Promise<string>((resolve, reject) => {
      const socket = connectTcp(forwardedPort, '127.0.0.1', () => {
        socket.write(
          'GET /raw-tcp HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n',
        );
      });
      localSockets.add(socket);
      let result = '';
      socket.on('data', (chunk: Buffer) => {
        result += chunk.toString();
      });
      socket.on('end', () => resolve(result));
      socket.on('error', reject);
      socket.on('close', () => localSockets.delete(socket));
    });
    expect(rawResponse).toContain('local:/raw-tcp');
    const disconnected = once(client, 'close');
    await runtime.stop();
    await disconnected;
    expect(runtime.sessions.get(sessionId)).toBeUndefined();
    expect(runtime.http.listening).toBe(false);
    expect(runtime.ssh.address()).toBeNull();
    await expect(
      new Promise<void>((resolve, reject) => {
        const socket = connectTcp(forwardedPort, '127.0.0.1', () => {
          socket.destroy();
          resolve();
        });
        socket.on('error', reject);
      }),
    ).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  it.each([
    ['/ws?probe=1', false],
    ['/ws?probe=1', true],
    ['/health', false],
    ['/metrics', false],
    ['/session/example/events', false],
    ['/.hole/ws', false],
  ] as const)(
    'forwards WebSocket messages on %s (HTTP warmup: %s)',
    async (path, warmup) => {
      const { snapshot } = await openTunnel();
      const host = `${snapshot.forwards[0].host}.example.test`;
      if (warmup)
        await request(runtime.http)
          .get('/warmup')
          .set('Host', host)
          .expect(200);

      const ws = openWebSocket(host, path);
      const greeting = once(ws, 'message');
      await once(ws, 'open');
      const [serverMessage, isBinary] = (await greeting) as [Buffer, boolean];
      expect(serverMessage.toString()).toBe(`server:${path}`);
      expect(isBinary).toBe(false);

      const textEcho = once(ws, 'message');
      ws.send('hello through SSH');
      const [text, textIsBinary] = (await textEcho) as [Buffer, boolean];
      expect(text.toString()).toBe('hello through SSH');
      expect(textIsBinary).toBe(false);

      const binaryEcho = once(ws, 'message');
      const payload = Buffer.from([0, 1, 128, 255]);
      ws.send(payload);
      const [binary, binaryIsBinary] = (await binaryEcho) as [Buffer, boolean];
      expect(binary).toEqual(payload);
      expect(binaryIsBinary).toBe(true);

      const closed = once(ws, 'close');
      ws.close(1000, 'done');
      const [code] = (await closed) as [number, Buffer];
      expect(code).toBe(1000);
      expect(runtime.http.listenerCount('upgrade')).toBe(1);
    },
  );

  it.each(['example.test', 'missing.example.test', 'x.example.test.evil.test'])(
    'rejects WebSocket upgrades for an unknown host: %s',
    async (host) => {
      await request(runtime.http)
        .get('/ws')
        .set({
          Host: host,
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        })
        .expect(404);
    },
  );

  it('closes a failed WebSocket upgrade without crashing the HTTP server', async () => {
    const { sessionId, forwardedPort, snapshot } = await openTunnel();
    const forward = runtime.sessions
      .get(sessionId)!
      .forwards.get(forwardedPort)!;
    await close(forward.server);
    const ws = openWebSocket(`${snapshot.forwards[0].host}.example.test`);
    await expect(once(ws, 'open')).rejects.toThrow();
    await request(runtime.http)
      .get('/health')
      .set('Host', 'example.test')
      .expect(200, { service: 'hole-api', status: 'ok' });
  });
});
