// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CustomerDisplayFrameMeta,
  CustomerDisplaySnapshot
} from '@odc-photostudio/contracts';
import { CustomerDisplayApp } from '../src/renderer/customer-display/CustomerDisplayApp.js';
import {
  createCustomerDisplayTransport,
  type CustomerDisplayFrame,
  type CustomerDisplayTransport
} from '../src/renderer/customer-display/transport.js';
import { toCustomerDisplayViewModel } from '../src/renderer/customer-display/view-model.js';

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn()
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electronMocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
    send: electronMocks.send
  }
}));

function snapshot(
  phase: CustomerDisplaySnapshot['phase'],
  update: Partial<CustomerDisplaySnapshot> = {}
): CustomerDisplaySnapshot {
  return {
    revision: 1,
    phase,
    sessionGeneration: phase === 'idle' ? 0 : 1,
    sessionId: phase === 'idle' ? null : '55000000-0000-4000-8000-000000000001',
    shotIndex: phase === 'idle' ? null : 1,
    shotCount: phase === 'idle' ? 0 : 3,
    countdownValue: phase === 'countdown' ? 3 : null,
    message: {
      idle: 'Step into frame',
      live: 'Look at the camera',
      countdown: 'Get ready',
      capturing: 'Hold that pose',
      preview: 'Looking good!',
      review: 'Your attendant is reviewing your photos',
      complete: 'All done — thank you!',
      recovering: 'One moment — your attendant is helping'
    }[phase],
    mirroredLiveView: true,
    liveFrameSequence: null,
    previewFrameSequence: null,
    updatedAt: '2026-10-20T00:00:00.000Z',
    ...update
  };
}

class FakeTransport implements CustomerDisplayTransport {
  private snapshotListener: ((value: CustomerDisplaySnapshot) => void) | null = null;
  private frameListener: ((value: CustomerDisplayFrame) => void) | null = null;
  readonly ackedSnapshots: number[] = [];
  readonly ackedFrames: number[] = [];
  closes = 0;

  constructor(private readonly initial: CustomerDisplaySnapshot) {}

  async getSnapshot(): Promise<CustomerDisplaySnapshot> {
    return this.initial;
  }

  onSnapshot(listener: (value: CustomerDisplaySnapshot) => void): () => void {
    this.snapshotListener = listener;
    return () => {
      this.snapshotListener = null;
    };
  }

  onFrame(listener: (value: CustomerDisplayFrame) => void): () => void {
    this.frameListener = listener;
    return () => {
      this.frameListener = null;
    };
  }

  ackSnapshot(revision: number): void {
    this.ackedSnapshots.push(revision);
  }

  ackFrame(sequence: number): void {
    this.ackedFrames.push(sequence);
  }

  close(): void {
    this.closes += 1;
  }

  emitSnapshot(value: CustomerDisplaySnapshot): void {
    this.snapshotListener?.(value);
  }

  emitFrame(meta: CustomerDisplayFrameMeta, jpeg = Uint8Array.of(1, 2, 3)): void {
    this.frameListener?.({ meta, jpeg });
  }
}

describe('customer display view model', () => {
  it.each([
    ['idle', 'Step into frame'],
    ['live', 'Look at the camera'],
    ['countdown', 'Get ready'],
    ['capturing', 'Hold that pose'],
    ['preview', 'Looking good!'],
    ['review', 'Your attendant is reviewing your photos'],
    ['complete', 'All done — thank you!'],
    ['recovering', 'One moment — your attendant is helping']
  ] as const)('maps %s to exact customer copy', (phase, expectedMessage) => {
    expect(toCustomerDisplayViewModel(snapshot(phase))).toMatchObject({
      phase,
      message: expectedMessage
    });
  });

  it('formats one-based shot progress and countdown accessibility text', () => {
    const model = toCustomerDisplayViewModel(snapshot('countdown'));
    expect(model.progress).toBe('Photo 2 of 3');
    expect(model.countdownLabel).toBe('Photo in 3');
  });
});

describe('CustomerDisplayApp', () => {
  const createObjectURL = vi.fn(() => 'blob:customer-frame');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders an accessible, non-interactive, orientation-safe countdown surface', async () => {
    render(<CustomerDisplayApp transport={new FakeTransport(snapshot('countdown'))} />);

    expect(await screen.findByRole('main')).toHaveClass(
      'customer-display',
      'customer-display--portrait-safe',
      'customer-display--landscape-safe'
    );
    expect(screen.getByText('3')).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByText('3')).toHaveClass('customer-display__countdown-pop');
    expect(screen.getByText('Get ready').closest('.customer-display__glass-badge')).not.toBeNull();
    expect(screen.getByText('Photo 2 of 3')).toBeVisible();
    expect(document.querySelector('button, a, input, select, textarea, form')).toBeNull();
  });

  it('mirrors live frames but never still previews, and acknowledges accepted data', async () => {
    const transport = new FakeTransport(snapshot('live'));
    render(<CustomerDisplayApp transport={transport} />);
    await screen.findByText('Look at the camera');
    expect(transport.ackedSnapshots).toEqual([1]);

    act(() => {
      transport.emitFrame({
        protocolVersion: 1,
        kind: 'live',
        sequence: 5,
        capturedAtMs: 1,
        byteLength: 3
      });
    });
    expect(screen.getByAltText('Live camera view')).toHaveClass('customer-display__image--mirrored');
    expect(transport.ackedFrames).toEqual([5]);

    act(() => {
      transport.emitSnapshot(snapshot('preview', { revision: 2, previewFrameSequence: 6 }));
      transport.emitFrame({
        protocolVersion: 1,
        kind: 'preview',
        sequence: 6,
        capturedAtMs: 2,
        byteLength: 3
      });
    });
    expect(screen.getByAltText('Captured photo preview')).not.toHaveClass(
      'customer-display__image--mirrored'
    );
    expect(screen.getByRole('main')).toHaveClass('customer-display--shutter-flash');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:customer-frame');
  });

  it('rejects stale snapshots and frames, revokes preview resources on exit and unmount', async () => {
    const transport = new FakeTransport(snapshot('live', { revision: 4 }));
    const view = render(<CustomerDisplayApp transport={transport} />);
    await screen.findByText('Look at the camera');

    act(() => {
      transport.emitSnapshot(snapshot('countdown', { revision: 3 }));
      transport.emitFrame({
        protocolVersion: 1,
        kind: 'preview',
        sequence: 8,
        capturedAtMs: 2,
        byteLength: 3
      });
      transport.emitFrame({
        protocolVersion: 1,
        kind: 'live',
        sequence: 7,
        capturedAtMs: 1,
        byteLength: 3
      });
    });
    expect(screen.queryByText('Get ready')).not.toBeInTheDocument();
    expect(transport.ackedFrames).toEqual([8]);

    act(() => transport.emitSnapshot(snapshot('live', { revision: 5 })));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:customer-frame');
    view.unmount();
    expect(transport.closes).toBe(1);
  });

  it('suppresses the shutter flash when the customer prefers reduced motion', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })) });
    render(<CustomerDisplayApp transport={new FakeTransport(snapshot('preview'))} />);
    expect(await screen.findByRole('main')).not.toHaveClass('customer-display--shutter-flash');
  });
});

describe('customer transport selection', () => {
  afterEach(() => {
    delete window.odcDisplayBridge;
  });

  it('uses only the narrow display bridge when Electron provides it', async () => {
    const initial = snapshot('idle');
    window.odcDisplayBridge = {
      getSnapshot: vi.fn(async () => initial),
      onSnapshot: vi.fn(() => vi.fn()),
      onFrame: vi.fn(() => vi.fn()),
      ackSnapshot: vi.fn(),
      ackFrame: vi.fn()
    };
    Object.defineProperty(window, 'odcOperatorBridge', {
      configurable: true,
      value: undefined
    });

    const transport = createCustomerDisplayTransport(window.location);
    await expect(transport.getSnapshot()).resolves.toEqual(initial);
    expect(window.odcOperatorBridge).toBeUndefined();
    transport.close();
  });
});

describe('customer display preload', () => {
  it('exposes only the narrow display API and removes the exact IPC listeners', async () => {
    const { displayApi } = await import('../src/preload/display.js');
    const stopSnapshots = displayApi.onSnapshot(vi.fn());
    const snapshotHandler = electronMocks.on.mock.calls.at(-1)?.[1];
    const stopFrames = displayApi.onFrame(vi.fn());
    const frameHandler = electronMocks.on.mock.calls.at(-1)?.[1];

    expect(electronMocks.exposeInMainWorld).toHaveBeenCalledWith('odcDisplayBridge', displayApi);
    expect(Object.keys(displayApi).sort()).toEqual([
      'ackFrame',
      'ackSnapshot',
      'getSnapshot',
      'onFrame',
      'onSnapshot'
    ]);

    stopSnapshots();
    stopFrames();
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      'odc:display:snapshot',
      snapshotHandler
    );
    expect(electronMocks.removeListener).toHaveBeenCalledWith('odc:display:frame', frameHandler);
  });
});
