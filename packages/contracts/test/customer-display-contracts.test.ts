import { describe, expect, it } from 'vitest';
import {
  CustomerDisplayPhaseSchema,
  CustomerDisplaySnapshotSchema,
  DisplayModeSchema,
  DisplaySettingsSchema,
  TabletDisplayStatusSchema
} from '../src/index.js';

describe('customer display contracts', () => {
  it('defaults display mode to off and port to 47940', () => {
    expect(DisplaySettingsSchema.parse({})).toEqual({
      mode: 'off',
      preferredWiredDisplay: null,
      tabletBindAddress: null,
      tabletPort: 47_940,
      mirroredLiveView: true
    });
  });

  it('accepts every customer phase', () => {
    expect(CustomerDisplayPhaseSchema.options).toEqual([
      'idle',
      'live',
      'countdown',
      'capturing',
      'preview',
      'review',
      'complete',
      'recovering'
    ]);
    expect(DisplayModeSchema.options).toEqual(['off', 'wired', 'tablet', 'both']);
  });

  it('rejects public bind addresses and malformed snapshots', () => {
    expect(() => DisplaySettingsSchema.parse({ tabletBindAddress: '8.8.8.8' })).toThrow();
    expect(() => DisplaySettingsSchema.parse({ tabletPort: 1023 })).toThrow();
    expect(() => DisplaySettingsSchema.parse({ tabletPort: 65_536 })).toThrow();

    const baseSnapshot = {
      revision: 1,
      phase: 'countdown',
      sessionGeneration: 1,
      sessionId: '55000000-0000-4000-8000-000000000001',
      shotIndex: 0,
      shotCount: 4,
      countdownValue: 3,
      message: 'Look at the camera',
      mirroredLiveView: true,
      liveFrameSequence: 1,
      previewFrameSequence: null,
      updatedAt: '2026-10-20T00:00:00.000Z'
    };

    expect(CustomerDisplaySnapshotSchema.parse(baseSnapshot).countdownValue).toBe(3);
    expect(() =>
      CustomerDisplaySnapshotSchema.parse({ ...baseSnapshot, countdownValue: 0 })
    ).toThrow();
    expect(() =>
      CustomerDisplaySnapshotSchema.parse({ ...baseSnapshot, countdownValue: 4 })
    ).toThrow();
    expect(() =>
      CustomerDisplaySnapshotSchema.parse({ ...baseSnapshot, phase: 'live', countdownValue: 2 })
    ).toThrow();
    expect(() =>
      CustomerDisplaySnapshotSchema.parse({ ...baseSnapshot, shotIndex: 4 })
    ).toThrow();
  });

  it('never exposes pairing secrets in paired status', () => {
    const paired = TabletDisplayStatusSchema.parse({
      state: 'paired',
      enabled: true,
      host: '192.168.4.2',
      port: 47_940,
      pairingUrl: null,
      pairingQrDataUrl: null,
      lastHeartbeatAt: '2026-10-20T00:00:00.000Z',
      error: null
    });
    expect(paired.pairingUrl).toBeNull();
    expect(paired.pairingQrDataUrl).toBeNull();

    expect(() =>
      TabletDisplayStatusSchema.parse({
        ...paired,
        pairingUrl: 'http://192.168.4.2:47940/?token=secret',
        pairingQrDataUrl: 'data:image/png;base64,c2VjcmV0'
      })
    ).toThrow();
  });
});
