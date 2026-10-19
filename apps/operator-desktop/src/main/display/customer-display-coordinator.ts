import {
  CustomerDisplaySnapshotSchema,
  type CustomerDisplaySnapshot,
  type CustomerDisplayPhase
} from '@odc-photostudio/contracts';
import { LatestFrameBroker } from './frame-broker.js';

const COUNTDOWN_STEP_MS = 1_000;
const PREVIEW_DURATION_MS = 2_000;
const LIVE_VIEW_STOP_GRACE_MS = 5_000;

export interface CustomerDisplayLiveViewSource {
  startLiveView(onFrame: (jpeg: Uint8Array) => void): Promise<void>;
  stopLiveView(): Promise<void>;
}

interface CustomerDisplayCoordinatorOptions {
  broker: LatestFrameBroker;
  liveView: CustomerDisplayLiveViewSource;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

interface CaptureResult<T> {
  result: T;
  previewJpeg: Uint8Array | null;
  allCaptured: boolean;
}

interface RunCaptureOptions<T> {
  sessionId: string;
  frameIndex: number;
  capture: () => Promise<CaptureResult<T>>;
}

type SnapshotListener = (snapshot: CustomerDisplaySnapshot) => void;

const PHASE_MESSAGES: Record<CustomerDisplayPhase, string> = {
  idle: 'Step into frame',
  live: 'Look at the camera',
  countdown: 'Get ready',
  capturing: 'Hold that pose',
  preview: 'Looking good!',
  review: 'Your attendant is reviewing your photos',
  complete: 'All done — thank you!',
  recovering: 'One moment — your attendant is helping'
};

function coordinatorError(code: string): Error {
  return new Error(code);
}

export class CustomerDisplayCoordinator {
  private readonly broker: LatestFrameBroker;
  private readonly liveView: CustomerDisplayLiveViewSource;
  private readonly now: () => number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly listeners = new Set<SnapshotListener>();
  private readonly consumers = new Set<string>();
  private snapshot: CustomerDisplaySnapshot;
  private captureAbortController: AbortController | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private liveViewStopTimer: ReturnType<typeof setTimeout> | null = null;
  private liveViewRunning = false;
  private liveViewStart: Promise<void> | null = null;
  private shutterExecuting = false;
  private closed = false;

  constructor(options: CustomerDisplayCoordinatorOptions) {
    this.broker = options.broker;
    this.liveView = options.liveView;
    this.now = options.now ?? Date.now;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    this.snapshot = CustomerDisplaySnapshotSchema.parse({
      revision: 0,
      phase: 'idle',
      sessionGeneration: 0,
      sessionId: null,
      shotIndex: null,
      shotCount: 0,
      countdownValue: null,
      message: PHASE_MESSAGES.idle,
      mirroredLiveView: true,
      liveFrameSequence: null,
      previewFrameSequence: null,
      updatedAt: new Date(this.now()).toISOString()
    });
    this.broker.publishSnapshot(this.snapshot);
  }

  public subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getSnapshot(): CustomerDisplaySnapshot {
    return this.snapshot;
  }

  public beginSession(input: { sessionId: string; shotCount: number }): void {
    this.assertOpen();
    this.assertShutterIdle();
    this.cancelPendingCapture();
    this.clearPreview();
    this.publish({
      phase: 'live',
      sessionGeneration: this.snapshot.sessionGeneration + 1,
      sessionId: input.sessionId,
      shotIndex: null,
      shotCount: input.shotCount,
      countdownValue: null,
      previewFrameSequence: null
    });
  }

  public async runCapture<T>(options: RunCaptureOptions<T>): Promise<T> {
    this.assertOpen();
    if (this.captureAbortController || this.previewTimer) {
      throw coordinatorError('DISPLAY_CAPTURE_BUSY');
    }
    if (this.snapshot.sessionId !== options.sessionId) {
      throw coordinatorError('DISPLAY_SESSION_MISMATCH');
    }
    if (options.frameIndex < 0 || options.frameIndex >= this.snapshot.shotCount) {
      throw coordinatorError('DISPLAY_FRAME_INDEX_INVALID');
    }

    const generation = this.snapshot.sessionGeneration;
    const abortController = new AbortController();
    this.captureAbortController = abortController;

    try {
      for (const countdownValue of [3, 2, 1]) {
        this.publish({
          phase: 'countdown',
          shotIndex: options.frameIndex,
          countdownValue,
          previewFrameSequence: null
        });
        await this.delay(COUNTDOWN_STEP_MS, abortController.signal);
      }

      this.throwIfAborted(abortController.signal);
      this.shutterExecuting = true;
      this.publish({ phase: 'capturing', countdownValue: null });
      const captureResult = await options.capture();
      this.shutterExecuting = false;
      this.throwIfAborted(abortController.signal);

      if (captureResult.previewJpeg === null) {
        this.captureAbortController = null;
        this.publish({
          phase: captureResult.allCaptured ? 'review' : 'live',
          countdownValue: null,
          previewFrameSequence: null
        });
        return captureResult.result;
      }

      const previewFrameSequence = this.broker.publishPreview(captureResult.previewJpeg, this.now());
      this.publish({ phase: 'preview', previewFrameSequence, countdownValue: null });
      this.captureAbortController = null;
      this.previewTimer = this.setTimeoutFn(() => {
        this.previewTimer = null;
        this.broker.clearPreview();
        if (
          !this.closed &&
          this.snapshot.sessionGeneration === generation &&
          this.snapshot.sessionId === options.sessionId
        ) {
          this.publish({
            phase: captureResult.allCaptured ? 'review' : 'live',
            countdownValue: null,
            previewFrameSequence: null
          });
        }
      }, PREVIEW_DURATION_MS);
      return captureResult.result;
    } catch (error) {
      this.shutterExecuting = false;
      if (this.captureAbortController === abortController) {
        this.captureAbortController = null;
      }
      if (abortController.signal.aborted) {
        throw coordinatorError('DISPLAY_CAPTURE_CANCELLED');
      }
      this.publish({ phase: 'recovering', countdownValue: null, previewFrameSequence: null });
      throw error;
    }
  }

  public approveSession(sessionId: string): void {
    this.assertOpen();
    if (this.snapshot.sessionId !== sessionId) {
      throw coordinatorError('DISPLAY_SESSION_MISMATCH');
    }
    this.clearPreview();
    this.publish({ phase: 'complete', countdownValue: null, previewFrameSequence: null });
  }

  public resetSession(): void {
    this.assertOpen();
    this.assertShutterIdle();
    this.cancelPendingCapture();
    this.clearPreview();
    this.publish({
      phase: 'idle',
      sessionGeneration: this.snapshot.sessionGeneration + 1,
      sessionId: null,
      shotIndex: null,
      shotCount: 0,
      countdownValue: null,
      previewFrameSequence: null
    });
  }

  public setCameraReady(ready: boolean): void {
    this.assertOpen();
    if (!ready) {
      this.publish({ phase: 'recovering', countdownValue: null });
      return;
    }
    if (this.snapshot.phase === 'recovering') {
      this.publish({
        phase: this.snapshot.sessionId ? 'live' : 'idle',
        countdownValue: null
      });
    }
  }

  public async addConsumer(consumerId: string): Promise<void> {
    this.assertOpen();
    this.consumers.add(consumerId);
    this.cancelLiveViewStop();
    if (this.liveViewRunning) return;
    if (!this.liveViewStart) {
      this.liveViewStart = this.liveView
        .startLiveView((jpeg) => {
          if (this.closed) return;
          const liveFrameSequence = this.broker.publishLive(jpeg, this.now());
          this.publish({ liveFrameSequence });
        })
        .then(() => {
          this.liveViewRunning = true;
        })
        .finally(() => {
          this.liveViewStart = null;
        });
    }
    await this.liveViewStart;
  }

  public removeConsumer(consumerId: string): void {
    this.consumers.delete(consumerId);
    if (this.consumers.size > 0 || this.liveViewStopTimer || !this.liveViewRunning) return;
    this.liveViewStopTimer = this.setTimeoutFn(() => {
      this.liveViewStopTimer = null;
      if (this.consumers.size > 0 || !this.liveViewRunning) return;
      this.liveViewRunning = false;
      void this.liveView.stopLiveView();
    }, LIVE_VIEW_STOP_GRACE_MS);
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.cancelPendingCapture();
    this.clearPreview(true);
    this.cancelLiveViewStop();
    this.listeners.clear();
    this.consumers.clear();
    if (this.liveViewStart) await this.liveViewStart;
    if (this.liveViewRunning) {
      this.liveViewRunning = false;
      await this.liveView.stopLiveView();
    }
  }

  private publish(update: Partial<CustomerDisplaySnapshot>): void {
    const phase = update.phase ?? this.snapshot.phase;
    this.snapshot = CustomerDisplaySnapshotSchema.parse({
      ...this.snapshot,
      ...update,
      revision: this.snapshot.revision + 1,
      message: update.message ?? PHASE_MESSAGES[phase],
      updatedAt: new Date(this.now()).toISOString()
    });
    this.broker.publishSnapshot(this.snapshot);
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private delay(durationMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(coordinatorError('DISPLAY_CAPTURE_CANCELLED'));
        return;
      }
      const timer = this.setTimeoutFn(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, durationMs);
      const onAbort = () => {
        this.clearTimeoutFn(timer);
        signal.removeEventListener('abort', onAbort);
        reject(coordinatorError('DISPLAY_CAPTURE_CANCELLED'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw coordinatorError('DISPLAY_CAPTURE_CANCELLED');
  }

  private assertShutterIdle(): void {
    if (this.shutterExecuting) throw coordinatorError('DISPLAY_CAPTURE_IN_PROGRESS');
  }

  private assertOpen(): void {
    if (this.closed) throw coordinatorError('DISPLAY_COORDINATOR_CLOSED');
  }

  private cancelPendingCapture(): void {
    this.captureAbortController?.abort();
    this.captureAbortController = null;
  }

  private clearPreview(force = false): void {
    const hadPreview = this.previewTimer !== null || this.snapshot.previewFrameSequence !== null;
    if (this.previewTimer) this.clearTimeoutFn(this.previewTimer);
    this.previewTimer = null;
    if (force || hadPreview) this.broker.clearPreview();
  }

  private cancelLiveViewStop(): void {
    if (this.liveViewStopTimer) this.clearTimeoutFn(this.liveViewStopTimer);
    this.liveViewStopTimer = null;
  }
}
