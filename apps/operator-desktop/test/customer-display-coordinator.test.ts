import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerDisplayCoordinator } from '../src/main/display/customer-display-coordinator.js';
import { LatestFrameBroker } from '../src/main/display/frame-broker.js';

const SESSION_ONE = '55000000-0000-4000-8000-000000000001';
const SESSION_TWO = '55000000-0000-4000-8000-000000000002';

function createLiveViewSource() {
  let listener: ((jpeg: Uint8Array) => void) | null = null;
  return {
    starts: 0,
    stops: 0,
    async startLiveView(onFrame: (jpeg: Uint8Array) => void) {
      this.starts += 1;
      listener = onFrame;
    },
    async stopLiveView() {
      this.stops += 1;
      listener = null;
    },
    emit(jpeg: Uint8Array) {
      listener?.(jpeg);
    }
  };
}

describe('CustomerDisplayCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drives countdown, capture, preview, review, approval, and reset phases', async () => {
    const broker = new LatestFrameBroker();
    const liveView = createLiveViewSource();
    const coordinator = new CustomerDisplayCoordinator({ broker, liveView });
    const observed: Array<{ phase: string; countdown: number | null }> = [];
    coordinator.subscribe((value) =>
      observed.push({ phase: value.phase, countdown: value.countdownValue })
    );

    coordinator.beginSession({ sessionId: SESSION_ONE, shotCount: 2 });
    const firstCapture = coordinator.runCapture({
      sessionId: SESSION_ONE,
      frameIndex: 0,
      capture: async () => ({
        result: { assetId: 'asset-1' },
        previewJpeg: Uint8Array.of(1, 2, 3),
        allCaptured: false
      })
    });

    expect(coordinator.getSnapshot()).toMatchObject({ phase: 'countdown', countdownValue: 3 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(coordinator.getSnapshot().countdownValue).toBe(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(coordinator.getSnapshot().countdownValue).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(firstCapture).resolves.toEqual({ assetId: 'asset-1' });
    expect(coordinator.getSnapshot()).toMatchObject({
      phase: 'preview',
      shotIndex: 0,
      previewFrameSequence: 1
    });
    expect(observed).toEqual(
      expect.arrayContaining([
        { phase: 'live', countdown: null },
        { phase: 'countdown', countdown: 3 },
        { phase: 'countdown', countdown: 2 },
        { phase: 'countdown', countdown: 1 },
        { phase: 'capturing', countdown: null },
        { phase: 'preview', countdown: null }
      ])
    );

    await vi.advanceTimersByTimeAsync(1_999);
    expect(coordinator.getSnapshot().phase).toBe('preview');
    await vi.advanceTimersByTimeAsync(1);
    expect(coordinator.getSnapshot().phase).toBe('live');

    const secondCapture = coordinator.runCapture({
      sessionId: SESSION_ONE,
      frameIndex: 1,
      capture: async () => ({
        result: { assetId: 'asset-2' },
        previewJpeg: Uint8Array.of(4, 5, 6),
        allCaptured: true
      })
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(secondCapture).resolves.toEqual({ assetId: 'asset-2' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(coordinator.getSnapshot().phase).toBe('review');

    coordinator.approveSession(SESSION_ONE);
    expect(coordinator.getSnapshot().phase).toBe('complete');
    coordinator.resetSession();
    expect(coordinator.getSnapshot()).toMatchObject({
      phase: 'idle',
      sessionId: null,
      shotIndex: null,
      shotCount: 0,
      previewFrameSequence: null
    });
  });

  it('rejects concurrent capture and cancels a countdown when the session resets', async () => {
    const coordinator = new CustomerDisplayCoordinator({
      broker: new LatestFrameBroker(),
      liveView: createLiveViewSource()
    });
    coordinator.beginSession({ sessionId: SESSION_ONE, shotCount: 2 });
    const first = coordinator.runCapture({
      sessionId: SESSION_ONE,
      frameIndex: 0,
      capture: async () => ({ result: 'captured', previewJpeg: Uint8Array.of(1), allCaptured: false })
    });

    await expect(
      coordinator.runCapture({
        sessionId: SESSION_ONE,
        frameIndex: 1,
        capture: async () => ({ result: 'duplicate', previewJpeg: Uint8Array.of(2), allCaptured: true })
      })
    ).rejects.toThrow('DISPLAY_CAPTURE_BUSY');

    coordinator.resetSession();
    await expect(first).rejects.toThrow('DISPLAY_CAPTURE_CANCELLED');
    expect(coordinator.getSnapshot().phase).toBe('idle');
  });

  it('rejects session replacement after shutter execution starts', async () => {
    let finishCapture!: (value: {
      result: string;
      previewJpeg: Uint8Array;
      allCaptured: boolean;
    }) => void;
    const coordinator = new CustomerDisplayCoordinator({
      broker: new LatestFrameBroker(),
      liveView: createLiveViewSource()
    });
    coordinator.beginSession({ sessionId: SESSION_ONE, shotCount: 1 });
    const capture = coordinator.runCapture({
      sessionId: SESSION_ONE,
      frameIndex: 0,
      capture: () =>
        new Promise((resolve) => {
          finishCapture = resolve;
        })
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(coordinator.getSnapshot().phase).toBe('capturing');
    expect(() => coordinator.beginSession({ sessionId: SESSION_TWO, shotCount: 1 })).toThrow(
      'DISPLAY_CAPTURE_IN_PROGRESS'
    );
    expect(() => coordinator.resetSession()).toThrow('DISPLAY_CAPTURE_IN_PROGRESS');

    finishCapture({ result: 'captured', previewJpeg: Uint8Array.of(1), allCaptured: true });
    await expect(capture).resolves.toBe('captured');
  });

  it('enters recovery after capture failure and restores the active session when ready', async () => {
    const coordinator = new CustomerDisplayCoordinator({
      broker: new LatestFrameBroker(),
      liveView: createLiveViewSource()
    });
    coordinator.beginSession({ sessionId: SESSION_ONE, shotCount: 1 });
    const capture = coordinator.runCapture({
      sessionId: SESSION_ONE,
      frameIndex: 0,
      capture: async () => {
        throw new Error('CAMERA_DISCONNECTED');
      }
    });
    const rejection = expect(capture).rejects.toThrow('CAMERA_DISCONNECTED');
    await vi.advanceTimersByTimeAsync(3_000);
    await rejection;
    expect(coordinator.getSnapshot().phase).toBe('recovering');

    coordinator.setCameraReady(true);
    expect(coordinator.getSnapshot().phase).toBe('live');
  });

  it('starts one live-view producer and stops five seconds after the final consumer leaves', async () => {
    const liveView = createLiveViewSource();
    const broker = new LatestFrameBroker();
    const publishLive = vi.spyOn(broker, 'publishLive');
    const coordinator = new CustomerDisplayCoordinator({ broker, liveView });

    await coordinator.addConsumer('wired');
    await coordinator.addConsumer('tablet');
    expect(liveView.starts).toBe(1);
    liveView.emit(Uint8Array.of(1, 2));
    expect(publishLive).toHaveBeenCalledTimes(1);

    coordinator.removeConsumer('wired');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(liveView.stops).toBe(0);
    coordinator.removeConsumer('tablet');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(liveView.stops).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(liveView.stops).toBe(1);

    await coordinator.addConsumer('wired');
    coordinator.removeConsumer('wired');
    await vi.advanceTimersByTimeAsync(4_000);
    await coordinator.addConsumer('tablet');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(liveView.stops).toBe(1);
    expect(liveView.starts).toBe(2);
  });

  it('clears preview bytes after the exact preview duration and during close', async () => {
    const broker = new LatestFrameBroker();
    const clearPreview = vi.spyOn(broker, 'clearPreview');
    const coordinator = new CustomerDisplayCoordinator({ broker, liveView: createLiveViewSource() });
    coordinator.beginSession({ sessionId: SESSION_ONE, shotCount: 1 });
    const capture = coordinator.runCapture({
      sessionId: SESSION_ONE,
      frameIndex: 0,
      capture: async () => ({ result: true, previewJpeg: Uint8Array.of(9), allCaptured: true })
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await capture;
    expect(clearPreview).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(clearPreview).toHaveBeenCalledTimes(1);

    await coordinator.close();
    expect(clearPreview).toHaveBeenCalledTimes(2);
  });
});
