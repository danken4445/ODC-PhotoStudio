import {
  CustomerDisplayFrameMetaSchema,
  CustomerDisplaySnapshotSchema,
  type CustomerDisplayFrameMeta,
  type CustomerDisplaySnapshot,
  type DisplayStreamMetrics
} from '@odc-photostudio/contracts';

const FRAME_HEADER_BYTES = 20;
const PRIORITY_TIMEOUT_MS = 2_000;

export interface CustomerDisplayFrame {
  meta: CustomerDisplayFrameMeta;
  jpeg: Uint8Array;
}

export interface DisplaySink {
  id: string;
  offerSnapshot(snapshot: CustomerDisplaySnapshot): boolean;
  offerFrame(frame: CustomerDisplayFrame): boolean;
  disconnect(reason: string): void;
}

interface SinkState {
  sink: DisplaySink;
  pendingSnapshotRevision: number | null;
  pendingFrameSequence: number | null;
  lastAcknowledgedFrameSequence: number;
  queuedLiveSequence: number | null;
  snapshotTimer: ReturnType<typeof setTimeout> | null;
  frameTimer: ReturnType<typeof setTimeout> | null;
}

export interface FrameBrokerOptions {
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export function encodeDisplayFrame(frame: CustomerDisplayFrame): Uint8Array {
  const meta = CustomerDisplayFrameMetaSchema.parse({
    ...frame.meta,
    byteLength: frame.jpeg.byteLength
  });
  const output = new Uint8Array(FRAME_HEADER_BYTES + frame.jpeg.byteLength);
  output.set([79, 68, 67, 70], 0);
  output[4] = meta.protocolVersion;
  output[5] = meta.kind === 'live' ? 1 : 2;
  const view = new DataView(output.buffer);
  view.setUint32(8, meta.sequence, false);
  view.setFloat64(12, meta.capturedAtMs, false);
  output.set(frame.jpeg, FRAME_HEADER_BYTES);
  return output;
}

export function decodeDisplayFrame(bytes: Uint8Array): CustomerDisplayFrame {
  if (bytes.byteLength < FRAME_HEADER_BYTES) {
    throw new Error('DISPLAY_FRAME_TRUNCATED');
  }
  if (bytes[0] !== 79 || bytes[1] !== 68 || bytes[2] !== 67 || bytes[3] !== 70) {
    throw new Error('DISPLAY_FRAME_INVALID_MAGIC');
  }
  if (bytes[4] !== 1) {
    throw new Error('DISPLAY_FRAME_UNSUPPORTED_VERSION');
  }
  if (bytes[5] !== 1 && bytes[5] !== 2) {
    throw new Error('DISPLAY_FRAME_INVALID_KIND');
  }
  if (bytes[6] !== 0 || bytes[7] !== 0) {
    throw new Error('DISPLAY_FRAME_INVALID_RESERVED_BYTES');
  }
  const jpeg = bytes.slice(FRAME_HEADER_BYTES);
  if (jpeg.byteLength === 0) {
    throw new Error('DISPLAY_FRAME_EMPTY_JPEG');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const meta = CustomerDisplayFrameMetaSchema.parse({
    protocolVersion: 1,
    kind: bytes[5] === 1 ? 'live' : 'preview',
    sequence: view.getUint32(8, false),
    capturedAtMs: view.getFloat64(12, false),
    byteLength: jpeg.byteLength
  });
  return { meta, jpeg };
}

export class LatestFrameBroker {
  private readonly now: () => number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly sinks = new Map<string, SinkState>();
  private currentSnapshot: CustomerDisplaySnapshot | null = null;
  private latestLive: CustomerDisplayFrame | null = null;
  private currentPreview: CustomerDisplayFrame | null = null;
  private nextSequence = 1;
  private framesPublished = 0;
  private framesDropped = 0;
  private readonly publishTimes: number[] = [];

  constructor(options: FrameBrokerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  public addSink(sink: DisplaySink): () => void {
    this.removeSink(sink.id);
    const state: SinkState = {
      sink,
      pendingSnapshotRevision: null,
      pendingFrameSequence: null,
      lastAcknowledgedFrameSequence: 0,
      queuedLiveSequence: null,
      snapshotTimer: null,
      frameTimer: null
    };
    this.sinks.set(sink.id, state);
    if (this.currentSnapshot) this.offerSnapshot(state, this.currentSnapshot);
    this.flushFrame(state);
    return () => this.removeSink(sink.id);
  }

  public publishSnapshot(snapshot: CustomerDisplaySnapshot): void {
    this.currentSnapshot = CustomerDisplaySnapshotSchema.parse(snapshot);
    for (const state of this.sinks.values()) {
      if (state.pendingSnapshotRevision === null) {
        this.offerSnapshot(state, this.currentSnapshot);
      }
    }
  }

  public publishLive(jpeg: Uint8Array, capturedAtMs: number): number {
    const frame = this.createFrame('live', jpeg, capturedAtMs);
    this.latestLive = frame;
    for (const state of this.sinks.values()) {
      if (this.currentPreview || state.pendingFrameSequence !== null) {
        if (state.queuedLiveSequence !== null) this.framesDropped += 1;
        state.queuedLiveSequence = frame.meta.sequence;
      } else {
        this.offerFrame(state, frame);
      }
    }
    return frame.meta.sequence;
  }

  public publishPreview(jpeg: Uint8Array, capturedAtMs: number): number {
    const frame = this.createFrame('preview', jpeg, capturedAtMs);
    this.currentPreview = frame;
    for (const state of this.sinks.values()) {
      if (state.pendingFrameSequence === null) {
        this.offerFrame(state, frame);
      } else {
        this.armFrameTimeout(state);
      }
    }
    return frame.meta.sequence;
  }

  public clearPreview(): void {
    this.currentPreview = null;
    for (const state of this.sinks.values()) {
      if (state.pendingFrameSequence === null) this.flushFrame(state);
    }
  }

  public ackSnapshot(sinkId: string, revision: number): void {
    const state = this.sinks.get(sinkId);
    if (!state || state.pendingSnapshotRevision !== revision) return;
    state.pendingSnapshotRevision = null;
    this.clearSnapshotTimer(state);
    if (this.currentSnapshot && this.currentSnapshot.revision > revision) {
      this.offerSnapshot(state, this.currentSnapshot);
    }
  }

  public ackFrame(sinkId: string, sequence: number): void {
    const state = this.sinks.get(sinkId);
    if (!state || state.pendingFrameSequence !== sequence) return;
    state.pendingFrameSequence = null;
    state.lastAcknowledgedFrameSequence = Math.max(state.lastAcknowledgedFrameSequence, sequence);
    this.clearFrameTimer(state);
    this.flushFrame(state);
  }

  public getMetrics(): DisplayStreamMetrics {
    const now = this.now();
    while (this.publishTimes.length > 0 && this.publishTimes[0]! < now - 1_000) {
      this.publishTimes.shift();
    }
    return {
      framesPublished: this.framesPublished,
      framesDropped: this.framesDropped,
      framesPerSecond: this.publishTimes.length,
      lastFrameAgeMs: this.latestLive
        ? Math.max(0, now - this.latestLive.meta.capturedAtMs)
        : null
    };
  }

  private createFrame(
    kind: CustomerDisplayFrameMeta['kind'],
    jpeg: Uint8Array,
    capturedAtMs: number
  ): CustomerDisplayFrame {
    const ownedJpeg = jpeg.slice();
    const frame: CustomerDisplayFrame = {
      meta: CustomerDisplayFrameMetaSchema.parse({
        protocolVersion: 1,
        kind,
        sequence: this.nextSequence++,
        capturedAtMs,
        byteLength: ownedJpeg.byteLength
      }),
      jpeg: ownedJpeg
    };
    this.framesPublished += 1;
    this.publishTimes.push(this.now());
    return frame;
  }

  private offerSnapshot(state: SinkState, snapshot: CustomerDisplaySnapshot): void {
    state.pendingSnapshotRevision = snapshot.revision;
    state.sink.offerSnapshot(snapshot);
    this.clearSnapshotTimer(state);
    state.snapshotTimer = this.setTimeoutFn(
      () => this.disconnectSink(state, 'DISPLAY_SINK_PRIORITY_TIMEOUT'),
      PRIORITY_TIMEOUT_MS
    );
  }

  private offerFrame(state: SinkState, frame: CustomerDisplayFrame): void {
    state.pendingFrameSequence = frame.meta.sequence;
    if (state.queuedLiveSequence === frame.meta.sequence) state.queuedLiveSequence = null;
    state.sink.offerFrame(frame);
    if (frame.meta.kind === 'preview') this.armFrameTimeout(state);
  }

  private flushFrame(state: SinkState): void {
    if (state.pendingFrameSequence !== null) return;
    if (
      this.currentPreview &&
      this.currentPreview.meta.sequence > state.lastAcknowledgedFrameSequence
    ) {
      this.offerFrame(state, this.currentPreview);
      return;
    }
    if (
      !this.currentPreview &&
      this.latestLive &&
      this.latestLive.meta.sequence > state.lastAcknowledgedFrameSequence
    ) {
      state.queuedLiveSequence = null;
      this.offerFrame(state, this.latestLive);
    }
  }

  private armFrameTimeout(state: SinkState): void {
    this.clearFrameTimer(state);
    state.frameTimer = this.setTimeoutFn(
      () => this.disconnectSink(state, 'DISPLAY_SINK_PRIORITY_TIMEOUT'),
      PRIORITY_TIMEOUT_MS
    );
  }

  private disconnectSink(state: SinkState, reason: string): void {
    this.removeSink(state.sink.id);
    state.sink.disconnect(reason);
  }

  private removeSink(sinkId: string): void {
    const state = this.sinks.get(sinkId);
    if (!state) return;
    this.clearSnapshotTimer(state);
    this.clearFrameTimer(state);
    this.sinks.delete(sinkId);
  }

  private clearSnapshotTimer(state: SinkState): void {
    if (state.snapshotTimer) this.clearTimeoutFn(state.snapshotTimer);
    state.snapshotTimer = null;
  }

  private clearFrameTimer(state: SinkState): void {
    if (state.frameTimer) this.clearTimeoutFn(state.frameTimer);
    state.frameTimer = null;
  }
}
