import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerDisplaySnapshot } from '@odc-photostudio/contracts';
import {
  LatestFrameBroker,
  decodeDisplayFrame,
  encodeDisplayFrame,
  type CustomerDisplayFrame,
  type DisplaySink
} from '../src/main/display/frame-broker.js';

function snapshot(revision: number): CustomerDisplaySnapshot {
  return {
    revision,
    phase: 'live',
    sessionGeneration: 1,
    sessionId: '55000000-0000-4000-8000-000000000001',
    shotIndex: 0,
    shotCount: 4,
    countdownValue: null,
    message: 'Look at the camera',
    mirroredLiveView: true,
    liveFrameSequence: revision,
    previewFrameSequence: null,
    updatedAt: '2026-10-20T00:00:00.000Z'
  };
}

function createSink(id = 'sink-1') {
  const snapshots: CustomerDisplaySnapshot[] = [];
  const frames: CustomerDisplayFrame[] = [];
  const disconnects: string[] = [];
  const sink: DisplaySink = {
    id,
    offerSnapshot(value) {
      snapshots.push(value);
      return true;
    },
    offerFrame(value) {
      frames.push(value);
      return true;
    },
    disconnect(reason) {
      disconnects.push(reason);
    }
  };
  return { sink, snapshots, frames, disconnects };
}

describe('LatestFrameBroker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips the exact ODCF binary envelope and rejects corrupt headers', () => {
    const frame: CustomerDisplayFrame = {
      meta: {
        protocolVersion: 1,
        kind: 'preview',
        sequence: 42,
        capturedAtMs: 1_792_454_400_125,
        byteLength: 4
      },
      jpeg: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])
    };

    const encoded = encodeDisplayFrame(frame);
    expect(Array.from(encoded.slice(0, 12))).toEqual([
      79, 68, 67, 70, 1, 2, 0, 0, 0, 0, 0, 42
    ]);
    expect(decodeDisplayFrame(encoded)).toEqual(frame);

    const corruptMagic = encoded.slice();
    corruptMagic[0] = 0;
    expect(() => decodeDisplayFrame(corruptMagic)).toThrow('DISPLAY_FRAME_INVALID_MAGIC');

    const corruptKind = encoded.slice();
    corruptKind[5] = 3;
    expect(() => decodeDisplayFrame(corruptKind)).toThrow('DISPLAY_FRAME_INVALID_KIND');
    expect(() => decodeDisplayFrame(encoded.slice(0, 20))).toThrow('DISPLAY_FRAME_EMPTY_JPEG');
  });

  it('keeps one unacknowledged live frame and replaces stale queued live frames', () => {
    const broker = new LatestFrameBroker();
    const receiver = createSink();
    broker.addSink(receiver.sink);

    const first = broker.publishLive(Uint8Array.of(1), Date.now());
    broker.publishLive(Uint8Array.of(2), Date.now() + 10);
    const latest = broker.publishLive(Uint8Array.of(3), Date.now() + 20);

    expect(receiver.frames.map((frame) => frame.meta.sequence)).toEqual([first]);
    broker.ackFrame(receiver.sink.id, first - 1);
    expect(receiver.frames).toHaveLength(1);
    broker.ackFrame(receiver.sink.id, first);
    expect(receiver.frames.map((frame) => frame.meta.sequence)).toEqual([first, latest]);
    expect(Array.from(receiver.frames[1]!.jpeg)).toEqual([3]);
    expect(broker.getMetrics().framesDropped).toBe(1);
  });

  it('prioritizes preview and resumes only with a post-preview live frame', () => {
    const broker = new LatestFrameBroker();
    const receiver = createSink();
    broker.addSink(receiver.sink);

    const live = broker.publishLive(Uint8Array.of(1), Date.now());
    const queuedLive = broker.publishLive(Uint8Array.of(2), Date.now() + 10);
    const preview = broker.publishPreview(Uint8Array.of(9), Date.now() + 20);

    broker.ackFrame(receiver.sink.id, live);
    expect(receiver.frames.map((frame) => frame.meta.sequence)).toEqual([live, preview]);
    broker.ackFrame(receiver.sink.id, preview);
    expect(receiver.frames).toHaveLength(2);

    broker.clearPreview();
    expect(receiver.frames).toHaveLength(2);
    const resumedLive = broker.publishLive(Uint8Array.of(4), Date.now() + 30);
    expect(receiver.frames.map((frame) => frame.meta.sequence)).toEqual([
      live,
      preview,
      resumedLive
    ]);
    expect(queuedLive).toBeLessThan(preview);
  });

  it('coalesces snapshots to the latest revision and ignores stale acknowledgements', () => {
    const broker = new LatestFrameBroker();
    const receiver = createSink();
    broker.addSink(receiver.sink);

    broker.publishSnapshot(snapshot(1));
    broker.publishSnapshot(snapshot(2));
    broker.publishSnapshot(snapshot(3));
    expect(receiver.snapshots.map((value) => value.revision)).toEqual([1]);

    broker.ackSnapshot(receiver.sink.id, 0);
    expect(receiver.snapshots).toHaveLength(1);
    broker.ackSnapshot(receiver.sink.id, 1);
    expect(receiver.snapshots.map((value) => value.revision)).toEqual([1, 3]);
  });

  it('disconnects a sink that blocks priority data for two seconds', () => {
    const broker = new LatestFrameBroker();
    const receiver = createSink();
    broker.addSink(receiver.sink);

    broker.publishLive(Uint8Array.of(1), Date.now());
    broker.publishPreview(Uint8Array.of(9), Date.now() + 10);
    vi.advanceTimersByTime(1_999);
    expect(receiver.disconnects).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(receiver.disconnects).toEqual(['DISPLAY_SINK_PRIORITY_TIMEOUT']);
  });

  it('reports publish, drop, frame-rate, and frame-age metrics', () => {
    const broker = new LatestFrameBroker();
    const receiver = createSink();
    broker.addSink(receiver.sink);

    broker.publishLive(Uint8Array.of(1), Date.now() - 25);
    broker.publishLive(Uint8Array.of(2), Date.now());
    expect(broker.getMetrics()).toMatchObject({
      framesPublished: 2,
      framesDropped: 0,
      lastFrameAgeMs: 0
    });
    expect(broker.getMetrics().framesPerSecond).toBeGreaterThan(0);
  });
});
