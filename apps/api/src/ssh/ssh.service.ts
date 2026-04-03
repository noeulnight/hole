import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createServer, Socket } from 'net';
import { dirname, resolve } from 'path';
import {
  AuthContext,
  Connection,
  ServerChannel,
  Server as SSHServer,
  TcpipBindInfo,
  utils,
} from 'ssh2';
import { PortService } from './port.service';
import { SessionService } from 'src/session/session.service';
import { resolveWorkspacePath } from 'src/common/utils/workspace-path';
import {
  forwardRequestsCounter,
  sshAuthAttemptsCounter,
} from 'src/common/metrics';

type AuthMode = 'noauth' | 'password';

interface HostKeyResult {
  hostKey: Buffer;
  hostKeyPath: string;
  generated: boolean;
  publicKeyPath?: string;
}

function loadOrCreateHostKey(hostKeyPath: string): HostKeyResult {
  const resolvedPath = resolve(hostKeyPath);
  if (existsSync(resolvedPath)) {
    return {
      hostKey: readFileSync(resolvedPath),
      hostKeyPath: resolvedPath,
      generated: false,
    };
  }

  mkdirSync(dirname(resolvedPath), { recursive: true });
  const generated = utils.generateKeyPairSync('ed25519', {
    comment: 'hole-host-key',
  });
  writeFileSync(resolvedPath, generated.private, {
    encoding: 'utf8',
    mode: 0o600,
  });

  const publicKeyPath = `${resolvedPath}.pub`;
  writeFileSync(publicKeyPath, generated.public, { encoding: 'utf8' });

  return {
    hostKey: Buffer.from(generated.private),
    hostKeyPath: resolvedPath,
    generated: true,
    publicKeyPath,
  };
}

@Injectable()
export class SshService extends SSHServer implements OnModuleDestroy {
  private readonly logger: Logger = new Logger(SshService.name);
  private readonly authMode: AuthMode;
  private readonly authUsername?: string;
  private readonly authPassword?: string;
  private readonly sshHost: string;
  private readonly sshPort: number;
  private readonly shellStreamsBySession = new Map<
    string,
    Set<ServerChannel>
  >();
  private readonly domain: string;

  constructor(
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService,
    private readonly portService: PortService,
  ) {
    const hostKeyPath = configService.get<string>(
      'SSH_HOST_KEY_PATH',
      './test.key',
    );
    const hostKey = loadOrCreateHostKey(resolveWorkspacePath(hostKeyPath));
    super({ hostKeys: [hostKey.hostKey] }, (client) =>
      this.handleClient(client),
    );

    this.sshHost = this.configService.get<string>('SSH_HOST', '0.0.0.0');
    this.sshPort = this.configService.get<number>('SSH_PORT', 2222);
    this.authMode = this.configService.get<AuthMode>('SSH_AUTH_MODE', 'noauth');
    this.authUsername = this.configService.get<string>('SSH_AUTH_USERNAME');
    this.domain = this.configService.get<string>('DOMAIN', 'localhost');

    if (this.authMode === 'password') {
      this.authPassword =
        this.configService.getOrThrow<string>('SSH_AUTH_PASSWORD');
    }

    if (hostKey.generated) {
      this.logger.warn(`SSH host key generated: ${hostKey.hostKeyPath}`);
      if (hostKey.publicKeyPath) {
        this.logger.log(
          `SSH host public key generated: ${hostKey.publicKeyPath}`,
        );
      }
    } else {
      this.logger.log(`SSH host key loaded: ${hostKey.hostKeyPath}`);
    }

    this.logger.log(`SSH auth mode: ${this.authMode}`);
    this.listen(this.sshPort, this.sshHost, () => {
      this.logger.log(
        `SSH server successfully started (${this.sshHost}:${this.sshPort})`,
      );
    });
  }

  private handleClient(client: Connection) {
    const session = this.sessionService.create();

    // Register error handler before authentication/ready to avoid uncaught socket errors.
    client.on('error', (error) => {
      this.logger.error(error);
    });
    client.on('authentication', (ctx) => this.handleAuthentication(ctx));
    client.on('ready', () => this.handleReady(session.id, client));
    client.on('close', () => this.handleClose(session.id));
  }

  private handleAuthentication(context: AuthContext) {
    if (this.authMode === 'noauth') {
      this.recordAuthAttempt(context.method, 'accepted');
      context.accept();
      return;
    }

    this.handlePasswordAuth(context);
  }

  private handlePasswordAuth(context: AuthContext) {
    if (context.method !== 'password') {
      this.recordAuthAttempt(context.method, 'rejected');
      context.reject(['password']);
      return;
    }

    const passwordContext = context;
    if (!this.isUsernameAllowed(passwordContext.username)) {
      this.recordAuthAttempt(passwordContext.method, 'rejected');
      passwordContext.reject();
      return;
    }
    if (!this.authPassword) {
      this.recordAuthAttempt(passwordContext.method, 'rejected');
      passwordContext.reject();
      return;
    }

    if (!this.matchSecret(passwordContext.password, this.authPassword)) {
      this.recordAuthAttempt(passwordContext.method, 'rejected');
      passwordContext.reject();
      return;
    }

    this.recordAuthAttempt(passwordContext.method, 'accepted');
    passwordContext.accept();
  }

  private isUsernameAllowed(username: string): boolean {
    if (!this.authUsername) {
      return true;
    }
    return this.matchSecret(username, this.authUsername);
  }

  private matchSecret(input: string, expected: string): boolean {
    const inputBuffer = Buffer.from(input);
    let expectedBuffer = Buffer.from(expected);
    const autoReject = inputBuffer.length !== expectedBuffer.length;
    if (autoReject) {
      expectedBuffer = inputBuffer;
    }
    const isEqual = timingSafeEqual(inputBuffer, expectedBuffer);
    return !autoReject && isEqual;
  }

  private handleClose(sessionId: string) {
    this.cleanupSessionShellStreams(sessionId);
    const releasedForwards = this.sessionService.delete(sessionId);
    for (const port of releasedForwards) {
      this.portService.release(port);
    }
  }

  private handleReady(sessionId: string, client: Connection) {
    client.on('request', (accept, reject, name, info: TcpipBindInfo) => {
      if (name === 'tcpip-forward') {
        this.handleForwardRequest(sessionId, client, info, accept, reject);
        return;
      }

      if (name === 'cancel-tcpip-forward' && accept) {
        this.handleCancelForwardRequest(sessionId, info, accept);
        return;
      }

      reject?.();
    });

    client.on('session', (accept) => {
      const session = accept();
      let shellStream: ServerChannel | null = null;

      session.on('pty', (accept) => accept());
      session.on('window-change', (accept) => accept());
      session.on('env', (accept) => accept?.());
      session.on('signal', (accept, _reject, info) => {
        accept?.();
        if (info.name !== 'INT') return;
        if (!shellStream || !shellStream.writable || shellStream.destroyed)
          return;

        shellStream.write('^C\r\n');
        shellStream.end();
      });
      session.on('shell', (accept) => {
        const stream = accept();
        shellStream = stream;
        this.registerSessionShellStream(sessionId, stream);
        this.writeSessionInfoToStream(sessionId, stream);

        stream.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          if (text.includes('\u0003')) {
            stream.write('^C\r\n');
            stream.end();
            return;
          }
        });
        stream.on('close', () => {
          if (shellStream === stream) {
            shellStream = null;
          }
        });
      });
    });
  }

  private handleForwardRequest(
    sessionId: string,
    client: Connection,
    info: TcpipBindInfo,
    accept?: (port?: number) => void,
    reject?: () => void,
  ) {
    if (!reject || !accept) return;
    const { bindPort: requestedPort, bindAddr: requrestedHost } = info;
    if (requestedPort !== 0) {
      forwardRequestsCounter.inc({ result: 'rejected' });
      return reject();
    }

    const bindedPort = this.portService.acquire();
    if (!bindedPort) {
      forwardRequestsCounter.inc({ result: 'rejected' });
      return reject();
    }

    const server = createServer((socket) =>
      this.forwardSocket(client, sessionId, requrestedHost, bindedPort, socket),
    );

    server.once('error', (error) => {
      this.logger.error(error);
    });

    server.listen(bindedPort, () => {
      const forward = this.sessionService.addForward(
        sessionId,
        bindedPort,
        server,
      );
      if (!forward) {
        forwardRequestsCounter.inc({ result: 'rejected' });
        return reject();
      }
      forwardRequestsCounter.inc({ result: 'accepted' });
      accept(bindedPort);
      this.broadcastSessionInfo(sessionId);
    });
  }

  private handleCancelForwardRequest(
    sessionId: string,
    info: TcpipBindInfo,
    accept: () => void,
  ) {
    const { bindPort } = info;
    this.portService.release(bindPort);
    this.sessionService.removeForwardByPort(sessionId, bindPort);
    accept?.();
    this.broadcastSessionInfo(sessionId);
  }

  private registerSessionShellStream(sessionId: string, stream: ServerChannel) {
    let streams = this.shellStreamsBySession.get(sessionId);
    if (!streams) {
      streams = new Set();
      this.shellStreamsBySession.set(sessionId, streams);
    }
    streams.add(stream);

    stream.on('close', () => {
      const streamSet = this.shellStreamsBySession.get(sessionId);
      if (!streamSet) return;
      streamSet.delete(stream);
      if (streamSet.size === 0) {
        this.shellStreamsBySession.delete(sessionId);
      }
    });
  }

  private cleanupSessionShellStreams(sessionId: string) {
    const streams = this.shellStreamsBySession.get(sessionId);
    if (!streams) return;

    for (const stream of streams) {
      if (stream.writable && !stream.destroyed) {
        stream.end();
      }
    }
    this.shellStreamsBySession.delete(sessionId);
  }

  private broadcastSessionInfo(sessionId: string) {
    const streams = this.shellStreamsBySession.get(sessionId);
    if (!streams || streams.size === 0) return;

    for (const stream of streams) {
      if (!stream.writable || stream.destroyed) {
        continue;
      }
      this.writeSessionInfoToStream(sessionId, stream);
    }
  }

  private writeSessionInfoToStream(sessionId: string, stream: ServerChannel) {
    const session = this.sessionService.get(sessionId);
    if (!session) return;

    const lines = [
      `sessionId: ${sessionId}`,
      `sessionEvents: https://${this.domain}/session/${sessionId}/events (SSE)`,
      `connectedAt: ${session.stats.connectedAt.toISOString()}`,
      '',
      'forwards:',
    ];
    const forwards = Array.from(session.forwards.values());
    if (forwards.length === 0) {
      lines.push('-');
    } else {
      for (const forward of forwards) {
        lines.push(
          `- http: https://${forward.host}.${this.domain}, tcp: ${this.domain}:${forward.port}`,
        );
      }
    }

    stream.write(`${lines.join('\r\n')}\r\n`);
  }

  private recordAuthAttempt(method: string, result: 'accepted' | 'rejected') {
    sshAuthAttemptsCounter.inc({
      mode: this.authMode,
      method,
      result,
    });
  }

  private forwardSocket(
    client: Connection,
    sessionId: string,
    bindAddr: string,
    bindPort: number,
    socket: Socket,
  ) {
    this.sessionService.recordTcpConnection(sessionId);

    let capturedError: string | undefined;

    const finalize = (trigger: string, error?: string) => {
      this.logger.log(
        `[${sessionId}] Connection finalized (${trigger})${error ? `: ${error}` : ''}`,
      );
    };

    socket.on('close', () => {
      finalize('socket', capturedError);
    });
    socket.on('error', (error: Error) => {
      capturedError ??= error.message;
      this.sessionService.recordTcpError(sessionId);
    });

    client.forwardOut(
      bindAddr,
      bindPort,
      socket.remoteAddress ?? '127.0.0.1',
      socket.remotePort ?? 0,
      (err, channel) => {
        if (err) {
          capturedError ??= err.message;
          this.sessionService.recordTcpError(sessionId);
          finalize('forward_error', capturedError);
          socket.destroy();
          return;
        }

        channel.on('error', (error: Error) => {
          capturedError ??= error.message;
          this.sessionService.recordTcpError(sessionId);
        });
        channel.on('close', () => {
          finalize('channel', capturedError);
        });

        socket.pipe(channel);
        channel.pipe(socket);

        socket.on('data', (chunk: Buffer) => {
          this.sessionService.recordTcpTraffic(
            sessionId,
            'uplink',
            chunk.length,
          );
        });
        channel.on('data', (chunk: Buffer) => {
          this.sessionService.recordTcpTraffic(
            sessionId,
            'downlink',
            chunk.length,
          );
        });
      },
    );
  }

  onModuleDestroy() {
    this.close();
  }
}
