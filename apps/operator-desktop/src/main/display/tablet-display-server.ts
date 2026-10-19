import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import {
  TabletDisplayStatusSchema,
  type CustomerDisplaySnapshot,
  type TabletDisplayStatus
} from '@odc-photostudio/contracts';
import { generateHighContrastQrBuffer } from '@odc-photostudio/template-engine';
import { CONTENT_SECURITY_POLICY } from '../window-security.js';
import {
  encodeDisplayFrame,
  type CustomerDisplayFrame,
  type DisplaySink,
  type LatestFrameBroker
} from './frame-broker.js';
import { isPrivateIpv4 } from './private-network.js';

const PAIRING_LIFETIME_MS = 10 * 60_000;
const SESSION_LIFETIME_MS = 12 * 60 * 60_000;
const RECONNECT_LIFETIME_MS = 5 * 60_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_BUFFERED_BYTES = 512 * 1024;
const MAX_FAILED_PAIR_ATTEMPTS = 8;
const RATE_WINDOW_MS = 60_000;
const COOKIE_NAME = 'odc_display_pair';

interface PairingCredential {
  value: string;
  createdAt: number;
}

interface PairedSession {
  value: string;
  expiresAt: number;
  disconnectedAt: number | null;
}

interface RateEntry {
  startedAt: number;
  count: number;
}

interface TabletDisplayServerOptions {
  broker: LatestFrameBroker;
  now?: () => number;
  tokenFactory?: () => string;
  generateQr?: (url: string) => Promise<Buffer>;
}

interface StartOptions {
  host: string;
  port: number;
  rendererRoot: string;
}

export class TabletDisplayServer {
  private readonly broker: LatestFrameBroker;
  private readonly now: () => number;
  private readonly tokenFactory: () => string;
  private readonly generateQr: (url: string) => Promise<Buffer>;
  private readonly listeners = new Set<(status: TabletDisplayStatus) => void>();
  private readonly rateLimits = new Map<string, RateEntry>();
  private httpServer: http.Server | null = null;
  private websocketServer: WebSocketServer | null = null;
  private activeSocket: WebSocket | null = null;
  private removeSink: (() => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pairing: PairingCredential | null = null;
  private session: PairedSession | null = null;
  private rendererRoot: string | null = null;
  private host: string | null = null;
  private port: number | null = null;
  private status: TabletDisplayStatus = TabletDisplayStatusSchema.parse({
    state: 'stopped',
    enabled: false,
    host: null,
    port: null,
    pairingUrl: null,
    pairingQrDataUrl: null,
    lastHeartbeatAt: null,
    error: null
  });

  constructor(options: TabletDisplayServerOptions) {
    this.broker = options.broker;
    this.now = options.now ?? Date.now;
    this.tokenFactory = options.tokenFactory ?? (() => crypto.randomBytes(32).toString('base64url'));
    this.generateQr =
      options.generateQr ??
      ((url) => generateHighContrastQrBuffer({ url, sizePx: 480, quietZoneModules: 4 }));
  }

  public async start(options: StartOptions): Promise<TabletDisplayStatus> {
    if (!isPrivateIpv4(options.host)) throw new Error('DISPLAY_BIND_ADDRESS_NOT_PRIVATE');
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
      throw new Error('DISPLAY_PORT_INVALID');
    }
    if (this.httpServer) await this.stop();

    const rendererRoot = path.resolve(options.rendererRoot);
    const indexPath = path.join(rendererRoot, 'index.html');
    if (!fs.statSync(indexPath).isFile()) throw new Error('DISPLAY_RENDERER_MISSING');
    this.rendererRoot = rendererRoot;
    this.host = options.host;
    this.rateLimits.clear();

    const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 1_024 });
    const server = http.createServer({ maxHeaderSize: 8_192 }, (request, response) => {
      void this.handleHttp(request, response);
    });
    server.requestTimeout = 10_000;
    server.headersTimeout = 10_000;
    server.on('upgrade', (request, socket, head) => {
      this.handleUpgrade(request, socket, head);
    });
    this.httpServer = server;
    this.websocketServer = websocketServer;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(options.port, options.host);
    });

    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('DISPLAY_SERVER_ADDRESS_UNAVAILABLE');
    this.port = address.port;
    await this.createPairing(true);
    return this.status;
  }

  public async stop(): Promise<void> {
    this.invalidateAccess();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    const server = this.httpServer;
    this.httpServer = null;
    this.websocketServer?.close();
    this.websocketServer = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    this.rendererRoot = null;
    this.host = null;
    this.port = null;
    this.publish({
      state: 'stopped',
      enabled: false,
      host: null,
      port: null,
      pairingUrl: null,
      pairingQrDataUrl: null,
      lastHeartbeatAt: null,
      error: null
    });
  }

  public resetPairing(): TabletDisplayStatus {
    if (!this.httpServer || !this.host || !this.port) return this.status;
    this.invalidateAccess();
    void this.createPairing(false);
    return this.status;
  }

  public getStatus(): TabletDisplayStatus {
    return this.status;
  }

  public onStatus(listener: (status: TabletDisplayStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async createPairing(waitForQr: boolean): Promise<void> {
    if (!this.host || !this.port) return;
    const token = this.createStrongToken();
    this.pairing = { value: token, createdAt: this.now() };
    this.session = null;
    const pairingUrl = `http://${this.host}:${this.port}/pair?token=${encodeURIComponent(token)}`;
    this.publish({
      state: 'awaiting_pairing',
      enabled: true,
      host: this.host,
      port: this.port,
      pairingUrl,
      pairingQrDataUrl: null,
      lastHeartbeatAt: null,
      error: null
    });
    const generate = this.generateQr(pairingUrl).then((buffer) => {
      if (this.pairing?.value !== token) return;
      this.publish({ ...this.status, pairingQrDataUrl: `data:image/png;base64,${buffer.toString('base64')}` });
    });
    if (waitForQr) await generate;
  }

  private async handleHttp(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<void> {
    this.applySecurityHeaders(response);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      this.respond(response, 405, 'Method Not Allowed');
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    } catch {
      this.respond(response, 400, 'Bad Request');
      return;
    }
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      this.respond(response, 400, 'Bad Request');
      return;
    }
    if (decodedPath.split('/').includes('..') || decodedPath.includes('\\')) {
      this.respond(response, 400, 'Bad Request');
      return;
    }

    if (decodedPath === '/pair') {
      this.handlePair(request, response, url.searchParams.get('token'));
      return;
    }
    if (decodedPath === '/' || decodedPath === '/display') {
      this.serveFile(response, 'index.html', request.method === 'HEAD');
      return;
    }
    if (/^\/assets\/[A-Za-z0-9._-]+$/.test(decodedPath)) {
      this.serveFile(response, decodedPath.slice(1), request.method === 'HEAD');
      return;
    }
    this.respond(response, 404, 'Not Found');
  }

  private handlePair(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    suppliedToken: string | null
  ): void {
    const remote = request.socket.remoteAddress ?? 'unknown';
    if (this.isRateLimited(remote)) {
      this.respond(response, 429, 'Too Many Requests');
      return;
    }
    const pairing = this.pairing;
    const valid =
      pairing !== null &&
      this.now() - pairing.createdAt <= PAIRING_LIFETIME_MS &&
      suppliedToken !== null &&
      this.secretsEqual(suppliedToken, pairing.value);
    if (!valid) {
      this.respond(response, 401, 'Pairing Invalid');
      return;
    }

    this.pairing = null;
    const sessionValue = this.createStrongToken();
    this.session = {
      value: sessionValue,
      expiresAt: this.now() + SESSION_LIFETIME_MS,
      disconnectedAt: null
    };
    response.statusCode = 302;
    response.setHeader('Location', '/display?surface=customer');
    response.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=${sessionValue}; Path=/; Max-Age=43200; HttpOnly; SameSite=Strict`
    );
    this.publish({
      state: 'reconnecting',
      enabled: true,
      host: this.host,
      port: this.port,
      pairingUrl: null,
      pairingQrDataUrl: null,
      lastHeartbeatAt: null,
      error: null
    });
    response.end();
  }

  private handleUpgrade(
    request: http.IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer
  ): void {
    let pathname = '';
    try {
      pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;
    } catch {
      this.rejectUpgrade(socket, 400);
      return;
    }
    if (pathname !== '/display/socket') {
      this.rejectUpgrade(socket, 404);
      return;
    }
    const expectedOrigin = `http://${this.host}:${this.port}`;
    if (request.headers.origin !== expectedOrigin || request.headers.host !== `${this.host}:${this.port}`) {
      this.rejectUpgrade(socket, 403);
      return;
    }
    if (!this.isSessionValid()) {
      if (this.httpServer) void this.createPairing(false);
      this.rejectUpgrade(socket, 401);
      return;
    }
    const cookie = this.readCookie(request.headers.cookie, COOKIE_NAME);
    if (!cookie || !this.session || !this.secretsEqual(cookie, this.session.value)) {
      this.rejectUpgrade(socket, 401);
      return;
    }
    if (this.activeSocket?.readyState === WebSocket.OPEN) {
      this.rejectUpgrade(socket, 409);
      return;
    }
    this.websocketServer!.handleUpgrade(request, socket, head, (websocket) => {
      this.attachSocket(websocket);
    });
  }

  private attachSocket(socket: WebSocket): void {
    this.activeSocket = socket;
    if (this.session) this.session.disconnectedAt = null;
    let alive = true;
    const heartbeat = () => {
      alive = true;
      this.publishHeartbeat();
    };
    socket.on('pong', heartbeat);
    socket.on('message', (data, isBinary) => {
      heartbeat();
      if (isBinary) return;
      this.handleSocketMessage(data.toString());
    });
    socket.on('close', () => {
      if (this.activeSocket !== socket) return;
      this.activeSocket = null;
      this.removeSink?.();
      this.removeSink = null;
      if (this.session) {
        this.session.disconnectedAt = this.now();
        this.publish({
          ...this.status,
          state: 'reconnecting',
          lastHeartbeatAt: new Date(this.now()).toISOString()
        });
      }
    });
    socket.on('error', () => undefined);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, HEARTBEAT_INTERVAL_MS);
    this.removeSink = this.broker.addSink(this.createSink(socket));
    this.publish({
      state: 'paired',
      enabled: true,
      host: this.host,
      port: this.port,
      pairingUrl: null,
      pairingQrDataUrl: null,
      lastHeartbeatAt: new Date(this.now()).toISOString(),
      error: null
    });
  }

  private createSink(socket: WebSocket): DisplaySink {
    return {
      id: 'tablet',
      offerSnapshot: (snapshot: CustomerDisplaySnapshot) => {
        if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_BUFFERED_BYTES) {
          return false;
        }
        socket.send(JSON.stringify({ v: 1, type: 'snapshot', payload: snapshot }));
        return true;
      },
      offerFrame: (frame: CustomerDisplayFrame) => {
        if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_BUFFERED_BYTES) {
          return false;
        }
        socket.send(encodeDisplayFrame(frame), { binary: true });
        return true;
      },
      disconnect: (reason: string) => {
        if (socket.readyState === WebSocket.OPEN) socket.close(1013, reason.slice(0, 100));
      }
    };
  }

  private handleSocketMessage(raw: string): void {
    if (Buffer.byteLength(raw) > 1_024) return;
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    const value = message as Record<string, unknown>;
    if (value.v !== 1) return;
    if (value.type === 'ack_snapshot' && Number.isInteger(value.revision)) {
      this.broker.ackSnapshot('tablet', value.revision as number);
    }
    if (value.type === 'ack_frame' && Number.isInteger(value.sequence)) {
      this.broker.ackFrame('tablet', value.sequence as number);
    }
  }

  private serveFile(response: http.ServerResponse, relativePath: string, head: boolean): void {
    if (!this.rendererRoot) {
      this.respond(response, 503, 'Unavailable');
      return;
    }
    const absolutePath = path.resolve(this.rendererRoot, relativePath);
    const prefix = `${this.rendererRoot}${path.sep}`;
    if (absolutePath !== path.join(this.rendererRoot, 'index.html') && !absolutePath.startsWith(prefix)) {
      this.respond(response, 400, 'Bad Request');
      return;
    }
    let file: Buffer;
    try {
      file = fs.readFileSync(absolutePath);
    } catch {
      this.respond(response, 404, 'Not Found');
      return;
    }
    const extension = path.extname(absolutePath);
    const contentType: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2'
    };
    if (!contentType[extension]) {
      this.respond(response, 404, 'Not Found');
      return;
    }
    response.statusCode = 200;
    response.setHeader('Content-Type', contentType[extension]);
    response.setHeader('Content-Length', file.byteLength);
    response.end(head ? undefined : file);
  }

  private applySecurityHeaders(response: http.ServerResponse): void {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
  }

  private respond(response: http.ServerResponse, statusCode: number, body: string): void {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end(body);
  }

  private isRateLimited(remote: string): boolean {
    const now = this.now();
    const current = this.rateLimits.get(remote);
    if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
      this.rateLimits.set(remote, { startedAt: now, count: 1 });
      return false;
    }
    current.count += 1;
    return current.count > MAX_FAILED_PAIR_ATTEMPTS;
  }

  private isSessionValid(): boolean {
    if (!this.session) return false;
    if (this.now() > this.session.expiresAt) {
      this.session = null;
      return false;
    }
    if (
      this.session.disconnectedAt !== null &&
      this.now() - this.session.disconnectedAt > RECONNECT_LIFETIME_MS
    ) {
      this.session = null;
      return false;
    }
    return true;
  }

  private invalidateAccess(): void {
    this.pairing = null;
    this.session = null;
    this.removeSink?.();
    this.removeSink = null;
    const socket = this.activeSocket;
    this.activeSocket = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.close(1000, 'pairing-reset');
  }

  private rejectUpgrade(socket: import('node:stream').Duplex, statusCode: number): void {
    const text = http.STATUS_CODES[statusCode] ?? 'Rejected';
    socket.write(`HTTP/1.1 ${statusCode} ${text}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  }

  private readCookie(header: string | undefined, name: string): string | null {
    for (const part of header?.split(';') ?? []) {
      const [key, ...value] = part.trim().split('=');
      if (key === name) return value.join('=');
    }
    return null;
  }

  private secretsEqual(left: string, right: string): boolean {
    const leftBytes = Buffer.from(left);
    const rightBytes = Buffer.from(right);
    return leftBytes.byteLength === rightBytes.byteLength && crypto.timingSafeEqual(leftBytes, rightBytes);
  }

  private createStrongToken(): string {
    const token = this.tokenFactory();
    if (!/^[A-Za-z0-9_-]+$/.test(token) || Buffer.from(token, 'base64url').byteLength < 16) {
      throw new Error('DISPLAY_TOKEN_FACTORY_WEAK');
    }
    return token;
  }

  private publishHeartbeat(): void {
    this.publish({ ...this.status, lastHeartbeatAt: new Date(this.now()).toISOString() });
  }

  private publish(status: TabletDisplayStatus): void {
    this.status = TabletDisplayStatusSchema.parse(status);
    for (const listener of this.listeners) listener(this.status);
  }
}
