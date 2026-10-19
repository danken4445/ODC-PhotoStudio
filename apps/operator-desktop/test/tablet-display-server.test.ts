import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { CustomerDisplaySnapshot } from '@odc-photostudio/contracts';
import { LatestFrameBroker, decodeDisplayFrame } from '../src/main/display/frame-broker.js';
import {
  isPrivateIpv4,
  listPrivateIpv4Interfaces
} from '../src/main/display/private-network.js';
import { TabletDisplayServer } from '../src/main/display/tablet-display-server.js';

const activeServers = new Set<TabletDisplayServer>();

function liveSnapshot(revision = 1): CustomerDisplaySnapshot {
  return {
    revision,
    phase: 'live',
    sessionGeneration: 1,
    sessionId: '55000000-0000-4000-8000-000000000001',
    shotIndex: 0,
    shotCount: 3,
    countdownValue: null,
    message: 'Look at the camera',
    mirroredLiveView: true,
    liveFrameSequence: null,
    previewFrameSequence: null,
    updatedAt: '2026-10-20T00:00:00.000Z'
  };
}

function rendererRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odc-tablet-renderer-'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><div id="root"></div><script type="module" src="./assets/app.js"></script>'
  );
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'globalThis.__DISPLAY_READY__ = true;');
  return root;
}

function createServer(
  broker = new LatestFrameBroker(),
  options: { now?: () => number; tokenFactory?: () => string } = {}
) {
  const server = new TabletDisplayServer({
    broker,
    now: options.now,
    tokenFactory: options.tokenFactory,
    generateQr: async () => Buffer.from('png')
  });
  activeServers.add(server);
  return { server, broker };
}

async function start(server: TabletDisplayServer) {
  return server.start({ host: '127.0.0.1', port: 0, rendererRoot: rendererRoot() });
}

async function pair(pairingUrl: string): Promise<{ cookie: string; baseUrl: string }> {
  const response = await fetch(pairingUrl, { redirect: 'manual' });
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe('/display?surface=customer');
  const setCookie = response.headers.get('set-cookie')!;
  expect(setCookie).toContain('odc_display_pair=');
  expect(setCookie).toContain('Max-Age=43200');
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toContain('SameSite=Strict');
  return {
    cookie: setCookie.split(';')[0]!,
    baseUrl: new URL(pairingUrl).origin
  };
}

function connect(
  baseUrl: string,
  cookie: string,
  origin = baseUrl
): { socket: WebSocket; responseStatus: Promise<number> } {
  const url = baseUrl.replace(/^http/, 'ws') + '/display/socket';
  let resolveStatus!: (status: number) => void;
  const responseStatus = new Promise<number>((resolve) => {
    resolveStatus = resolve;
  });
  const socket = new WebSocket(url, { headers: { Origin: origin, Cookie: cookie } });
  socket.on('unexpected-response', (_request, response) => resolveStatus(response.statusCode ?? 0));
  socket.on('open', () => resolveStatus(101));
  socket.on('error', () => undefined);
  return { socket, responseStatus };
}

afterEach(async () => {
  await Promise.all([...activeServers].map((server) => server.stop()));
  activeServers.clear();
  vi.useRealTimers();
});

describe('private IPv4 selection', () => {
  it.each(['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.10', '127.0.0.1'])(
    'accepts %s',
    (address) => expect(isPrivateIpv4(address)).toBe(true)
  );

  it.each(['0.0.0.0', '8.8.8.8', '172.32.0.1', '224.0.0.1', '::1', '192.168.1', '01.2.3.4'])(
    'rejects %s',
    (address) => expect(isPrivateIpv4(address)).toBe(false)
  );

  it('returns only selectable IPv4 interfaces in deterministic order', () => {
    expect(
      listPrivateIpv4Interfaces({
        WiFi: [
          { address: '192.168.1.20', family: 'IPv4', internal: false, netmask: '255.255.255.0', cidr: '192.168.1.20/24', mac: 'a', scopeid: 0 },
          { address: 'fe80::1', family: 'IPv6', internal: false, netmask: 'ffff::', cidr: null, mac: 'b', scopeid: 0 }
        ],
        Public: [
          { address: '8.8.8.8', family: 'IPv4', internal: false, netmask: '255.255.255.0', cidr: '8.8.8.8/24', mac: 'c', scopeid: 0 }
        ],
        Loopback: [
          { address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '255.0.0.0', cidr: '127.0.0.1/8', mac: 'd', scopeid: 0 }
        ]
      })
    ).toEqual([
      { name: 'Loopback', address: '127.0.0.1', internal: true },
      { name: 'WiFi', address: '192.168.1.20', internal: false }
    ]);
  });
});

describe('TabletDisplayServer HTTP pairing', () => {
  it('creates a strong one-time pairing URL, secure cookie, token-free redirect, and redacted status', async () => {
    const { server } = createServer();
    const status = await start(server);
    expect(status.state).toBe('awaiting_pairing');
    expect(status.pairingQrDataUrl).toMatch(/^data:image\/png;base64,/);
    const pairingUrl = new URL(status.pairingUrl!);
    expect(pairingUrl.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{22,}$/);

    const { cookie } = await pair(status.pairingUrl!);
    expect(cookie).not.toContain(pairingUrl.searchParams.get('token')!);
    expect(server.getStatus()).toMatchObject({
      state: 'reconnecting',
      pairingUrl: null,
      pairingQrDataUrl: null
    });
    const reused = await fetch(status.pairingUrl!, { redirect: 'manual' });
    expect(reused.status).toBe(401);
  });

  it('expires an unused pairing URL after ten minutes', async () => {
    let now = 1_000;
    const { server } = createServer(new LatestFrameBroker(), { now: () => now });
    const status = await start(server);
    now += 10 * 60_000 + 1;
    expect((await fetch(status.pairingUrl!, { redirect: 'manual' })).status).toBe(401);
  });

  it('serves only allowlisted renderer files with hardened response headers', async () => {
    const { server } = createServer();
    const status = await start(server);
    const base = new URL(status.pairingUrl!).origin;
    const page = await fetch(`${base}/display?surface=customer`);
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await page.text()).toContain('id="root"');
    expect((await fetch(`${base}/assets/app.js`)).status).toBe(200);
    expect((await fetch(`${base}/unknown`)).status).toBe(404);
    expect((await fetch(`${base}/assets/%2e%2e%2findex.html`)).status).toBe(400);
  });

  it('rate limits repeated failed pairing attempts and can stop then rebind the port', async () => {
    const { server } = createServer();
    const status = await start(server);
    const url = new URL(status.pairingUrl!);
    url.searchParams.set('token', 'wrong');
    const codes: number[] = [];
    for (let index = 0; index < 9; index += 1) {
      codes.push((await fetch(url, { redirect: 'manual' })).status);
    }
    expect(codes.at(-1)).toBe(429);
    const port = status.port!;
    await server.stop();
    expect(server.getStatus().state).toBe('stopped');
    await expect(
      server.start({ host: '127.0.0.1', port, rendererRoot: rendererRoot() })
    ).resolves.toMatchObject({ state: 'awaiting_pairing', port });
  });
});

describe('TabletDisplayServer WebSocket lifecycle', () => {
  it('validates origin/cookie, enforces one client, replays state, sends binary frames, and accepts acks', async () => {
    const { server, broker } = createServer();
    broker.publishSnapshot(liveSnapshot());
    const status = await start(server);
    const { cookie, baseUrl } = await pair(status.pairingUrl!);

    const invalid = connect(baseUrl, cookie, 'http://evil.example');
    await expect(invalid.responseStatus).resolves.toBe(403);
    invalid.socket.terminate();

    const first = connect(baseUrl, cookie);
    const firstMessage = new Promise<{ data: WebSocket.RawData; binary: boolean }>((resolve) =>
      first.socket.once('message', (data, binary) => resolve({ data, binary }))
    );
    await expect(first.responseStatus).resolves.toBe(101);
    const initial = await firstMessage;
    expect(initial.binary).toBe(false);
    expect(JSON.parse(initial.data.toString())).toEqual({
      v: 1,
      type: 'snapshot',
      payload: liveSnapshot()
    });
    expect(server.getStatus()).toMatchObject({ state: 'paired', pairingUrl: null });

    const second = connect(baseUrl, cookie);
    await expect(second.responseStatus).resolves.toBe(409);
    second.socket.terminate();

    first.socket.send(JSON.stringify({ v: 1, type: 'ack_snapshot', revision: 1 }));
    const frameMessage = new Promise<WebSocket.RawData>((resolve) =>
      first.socket.once('message', (data, binary) => binary && resolve(data))
    );
    const sequence = broker.publishLive(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), Date.now());
    const frame = decodeDisplayFrame(new Uint8Array(await frameMessage));
    expect(frame.meta.sequence).toBe(sequence);
    first.socket.send(JSON.stringify({ v: 1, type: 'ack_frame', sequence }));
    first.socket.close();
    await once(first.socket, 'close');
  });

  it('allows reconnect for five minutes, then invalidates the cookie and requires pairing', async () => {
    let now = 10_000;
    const { server } = createServer(new LatestFrameBroker(), { now: () => now });
    const status = await start(server);
    const { cookie, baseUrl } = await pair(status.pairingUrl!);
    const first = connect(baseUrl, cookie);
    await expect(first.responseStatus).resolves.toBe(101);
    first.socket.close();
    await once(first.socket, 'close');
    await vi.waitFor(() => expect(server.getStatus().state).toBe('reconnecting'));

    now += 4 * 60_000;
    const reconnect = connect(baseUrl, cookie);
    await expect(reconnect.responseStatus).resolves.toBe(101);
    reconnect.socket.close();
    await once(reconnect.socket, 'close');
    await vi.waitFor(() => expect(server.getStatus().state).toBe('reconnecting'));

    now += 5 * 60_000 + 1;
    const expired = connect(baseUrl, cookie);
    await expect(expired.responseStatus).resolves.toBe(401);
    expired.socket.terminate();
    expect(server.getStatus().state).toBe('awaiting_pairing');
    expect(server.getStatus().pairingUrl).not.toBeNull();
  });

  it('invalidates paired access on reset and stop', async () => {
    const { server } = createServer();
    const status = await start(server);
    const { cookie, baseUrl } = await pair(status.pairingUrl!);
    const connection = connect(baseUrl, cookie);
    await expect(connection.responseStatus).resolves.toBe(101);
    const closed = once(connection.socket, 'close');
    const reset = server.resetPairing();
    await closed;
    expect(reset).toMatchObject({ state: 'awaiting_pairing' });
    expect(reset.pairingUrl).not.toBeNull();

    const stale = connect(baseUrl, cookie);
    await expect(stale.responseStatus).resolves.toBe(401);
    stale.socket.terminate();
    await server.stop();
    expect(server.getStatus()).toMatchObject({ state: 'stopped', enabled: false });
  });
});
