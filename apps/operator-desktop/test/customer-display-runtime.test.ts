import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DisplaySettings,
  TabletDisplayStatus,
  WiredDisplayStatus
} from '@odc-photostudio/contracts';
import { LatestFrameBroker } from '../src/main/display/frame-broker.js';
import { CustomerDisplayRuntime } from '../src/main/display/customer-display-runtime.js';

const SESSION = '55000000-0000-4000-8000-000000000001';

function settings(update: Partial<DisplaySettings> = {}): DisplaySettings {
  return {
    mode: 'off',
    preferredWiredDisplay: null,
    tabletBindAddress: null,
    tabletPort: 47940,
    mirroredLiveView: true,
    ...update
  };
}

function fakeWired() {
  let status: WiredDisplayStatus = { state: 'closed', selectedFingerprint: null, error: null };
  const listeners = new Set<(value: WiredDisplayStatus) => void>();
  return {
    listTargets: vi.fn(() => []),
    identify: vi.fn(async () => undefined),
    open: vi.fn(async (fingerprint: string) => {
      status = { state: 'active', selectedFingerprint: fingerprint, error: null };
      for (const listener of listeners) listener(status);
      return status;
    }),
    close: vi.fn(() => {
      status = { state: 'closed', selectedFingerprint: null, error: null };
      for (const listener of listeners) listener(status);
    }),
    getStatus: () => status,
    onStatus: (listener: (value: WiredDisplayStatus) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: vi.fn(),
    emit(value: WiredDisplayStatus) {
      status = value;
      for (const listener of listeners) listener(status);
    }
  };
}

function fakeTablet() {
  let status: TabletDisplayStatus = {
    state: 'stopped',
    enabled: false,
    host: null,
    port: null,
    pairingUrl: null,
    pairingQrDataUrl: null,
    lastHeartbeatAt: null,
    error: null
  };
  const listeners = new Set<(value: TabletDisplayStatus) => void>();
  return {
    start: vi.fn(async ({ host, port }: { host: string; port: number }) => {
      status = {
        ...status,
        state: 'paired',
        enabled: true,
        host,
        port,
        lastHeartbeatAt: '2026-10-20T00:00:00.000Z'
      };
      for (const listener of listeners) listener(status);
      return status;
    }),
    stop: vi.fn(async () => {
      status = { ...status, state: 'stopped', enabled: false, host: null, port: null };
      for (const listener of listeners) listener(status);
    }),
    resetPairing: vi.fn(() => status),
    getStatus: () => status,
    onStatus: (listener: (value: TabletDisplayStatus) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(value: TabletDisplayStatus) {
      status = value;
      for (const listener of listeners) listener(status);
    }
  };
}

function createHarness(initialSettings = settings()) {
  const broker = new LatestFrameBroker();
  const wired = fakeWired();
  const tablet = fakeTablet();
  const camera = {
    starts: 0,
    stops: 0,
    async startLiveView() {
      this.starts += 1;
    },
    async stopLiveView() {
      this.stops += 1;
    }
  };
  let captured = 0;
  const orchestrator = {
    captureFrame: vi.fn(async ({ frameIndex }: { frameIndex: number }) => {
      captured += 1;
      return {
        session: { capture_state: captured >= 2 ? 'reviewing' : 'capturing' },
        capture: {
          assetId: `asset-${frameIndex}`,
          frameIndex,
          localFilePath: `shot-${frameIndex}.jpg`,
          capturedAt: '2026-10-20T00:00:00.000Z',
          width: 1200,
          height: 1600,
          sha256: 'a'.repeat(64)
        }
      };
    }),
    approveAndCompositeSession: vi.fn(async () => ({
      session: {
        session_id: SESSION,
        capture_state: 'approved',
        composite_state: 'ready',
        upload_state: 'uploading'
      }
    }))
  };
  let storedSettings = initialSettings;
  const runtime = new CustomerDisplayRuntime({
    orchestrator,
    camera,
    broker,
    wired,
    tablet,
    rendererRoot: 'renderer',
    loadSettings: () => storedSettings,
    saveSettings: (value) => {
      storedSettings = value;
      return value;
    },
    listInterfaces: () => [{ name: 'Wi-Fi', address: '192.168.1.20', internal: false }],
    readPreview: () => Uint8Array.of(9, 8, 7)
  });
  return { runtime, broker, wired, tablet, camera, orchestrator };
}

describe('CustomerDisplayRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('starts one camera producer for wired and tablet consumers and none when both are off', async () => {
    const off = createHarness();
    await off.runtime.initialize();
    expect(off.camera.starts).toBe(0);
    await off.runtime.close();

    const both = createHarness(
      settings({
        mode: 'both',
        preferredWiredDisplay: {
          fingerprint: 'v1:panel',
          id: 2,
          label: 'Panel',
          bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
          size: { width: 1920, height: 1080 },
          scaleFactor: 1,
          rotation: 0,
          internal: false,
          primary: false
        },
        tabletBindAddress: '192.168.1.20'
      })
    );
    await both.runtime.initialize();
    expect(both.camera.starts).toBe(1);
    both.wired.emit({ state: 'missing', selectedFingerprint: 'v1:panel', error: null });
    both.tablet.emit({ ...both.tablet.getStatus(), state: 'reconnecting' });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(both.camera.stops).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(both.camera.stops).toBe(1);
    await both.runtime.close();
  });

  it('runs exact countdown, captures through the orchestrator, previews actual bytes, reviews, approves, and resets', async () => {
    const { runtime, broker, orchestrator } = createHarness();
    const publishPreview = vi.spyOn(broker, 'publishPreview');
    await runtime.initialize();
    runtime.beginSession({ sessionId: SESSION, shotCount: 2 });
    expect(runtime.getSnapshot().phase).toBe('live');

    const first = runtime.captureFrame({ sessionId: SESSION, frameIndex: 0 });
    expect(runtime.getSnapshot()).toMatchObject({ phase: 'countdown', countdownValue: 3 });
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(first).resolves.toMatchObject({ assetId: 'asset-0', frameIndex: 0 });
    expect(publishPreview).toHaveBeenCalledWith(Uint8Array.of(9, 8, 7), Date.now());
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runtime.getSnapshot().phase).toBe('live');

    const second = runtime.captureFrame({ sessionId: SESSION, frameIndex: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    await second;
    expect(runtime.getSnapshot().phase).toBe('review');
    await expect(runtime.approveSession(SESSION)).resolves.toMatchObject({ captureState: 'approved' });
    expect(orchestrator.approveAndCompositeSession).toHaveBeenCalled();
    expect(runtime.getSnapshot().phase).toBe('complete');
    runtime.resetSession();
    expect(runtime.getSnapshot().phase).toBe('idle');
    await runtime.close();
  });

  it('preserves capture race guarantees when transports disconnect mid-countdown', async () => {
    const { runtime, wired, tablet, orchestrator } = createHarness();
    await runtime.initialize();
    runtime.beginSession({ sessionId: SESSION, shotCount: 2 });
    const first = runtime.captureFrame({ sessionId: SESSION, frameIndex: 0 });
    await expect(runtime.captureFrame({ sessionId: SESSION, frameIndex: 1 })).rejects.toThrow(
      'DISPLAY_CAPTURE_BUSY'
    );
    wired.emit({ state: 'missing', selectedFingerprint: null, error: null });
    tablet.emit({ ...tablet.getStatus(), state: 'reconnecting' });
    await vi.advanceTimersByTimeAsync(3_000);
    await first;
    expect(orchestrator.captureFrame).toHaveBeenCalledTimes(1);
    await runtime.close();
  });

  it('enters recovery on camera failure and isolates display sink failures from approval', async () => {
    const { runtime, broker, orchestrator } = createHarness();
    broker.addSink({
      id: 'broken-display',
      offerSnapshot: () => {
        throw new Error('DISPLAY_SEND_FAILED');
      },
      offerFrame: () => {
        throw new Error('DISPLAY_SEND_FAILED');
      },
      disconnect: () => undefined
    });
    await runtime.initialize();
    runtime.beginSession({ sessionId: SESSION, shotCount: 1 });
    orchestrator.captureFrame.mockRejectedValueOnce(new Error('CAMERA_DISCONNECTED'));
    const capture = runtime.captureFrame({ sessionId: SESSION, frameIndex: 0 });
    const rejection = expect(capture).rejects.toThrow('CAMERA_DISCONNECTED');
    await vi.advanceTimersByTimeAsync(3_000);
    await rejection;
    expect(runtime.getSnapshot().phase).toBe('recovering');

    await expect(runtime.approveSession(SESSION)).resolves.toMatchObject({ captureState: 'approved' });
    runtime.resetSession();
    expect(runtime.getSnapshot().phase).toBe('idle');
    await runtime.close();
  });

  it('cancels a pre-shutter countdown on reset without touching the camera', async () => {
    const { runtime, orchestrator } = createHarness();
    await runtime.initialize();
    runtime.beginSession({ sessionId: SESSION, shotCount: 2 });
    const capture = runtime.captureFrame({ sessionId: SESSION, frameIndex: 0 });
    const rejection = expect(capture).rejects.toThrow('DISPLAY_CAPTURE_CANCELLED');
    await vi.advanceTimersByTimeAsync(1_000);
    runtime.resetSession();
    await rejection;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(orchestrator.captureFrame).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().phase).toBe('idle');
    await runtime.close();
  });

  it('rejects session replacement and reset once the shutter has started', async () => {
    const { runtime, orchestrator } = createHarness();
    await runtime.initialize();
    runtime.beginSession({ sessionId: SESSION, shotCount: 2 });
    let release: () => void = () => undefined;
    orchestrator.captureFrame.mockImplementationOnce(
      ({ frameIndex }: { frameIndex: number }) =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              session: { capture_state: 'capturing' },
              capture: {
                assetId: 'asset-0',
                frameIndex,
                localFilePath: 'shot-0.jpg',
                capturedAt: '2026-10-20T00:00:00.000Z',
                width: 1200,
                height: 1600,
                sha256: 'a'.repeat(64)
              }
            });
        }) as never
    );
    const capture = runtime.captureFrame({ sessionId: SESSION, frameIndex: 0 });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(() =>
      runtime.beginSession({ sessionId: '55000000-0000-4000-8000-000000000002', shotCount: 2 })
    ).toThrow('DISPLAY_CAPTURE_IN_PROGRESS');
    expect(() => runtime.resetSession()).toThrow('DISPLAY_CAPTURE_IN_PROGRESS');
    release();
    await expect(capture).resolves.toMatchObject({ assetId: 'asset-0' });
    await runtime.close();
  });
});
