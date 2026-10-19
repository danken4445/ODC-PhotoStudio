import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LatestFrameBroker } from '../src/main/display/frame-broker.js';
import {
  WiredDisplayManager,
  type CustomerWindow,
  type CustomerWindowFactory,
  type CustomerWindowOptions,
  type ElectronDisplayLike,
  type ElectronScreenAdapter
} from '../src/main/display/wired-display-manager.js';

function display(
  id: number,
  x: number,
  update: Partial<ElectronDisplayLike> = {}
): ElectronDisplayLike {
  return {
    id,
    label: `Display ${id}`,
    bounds: { x, y: 0, width: 1920, height: 1080 },
    size: { width: 1920, height: 1080 },
    scaleFactor: 1,
    rotation: 0,
    internal: false,
    ...update
  };
}

class FakeScreen implements ElectronScreenAdapter {
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(public displays: ElectronDisplayLike[], public primaryId = displays[0]?.id ?? 0) {}

  getAllDisplays(): ElectronDisplayLike[] {
    return this.displays;
  }

  getPrimaryDisplay(): ElectronDisplayLike {
    return this.displays.find((item) => item.id === this.primaryId) ?? this.displays[0]!;
  }

  on(event: 'display-added' | 'display-removed' | 'display-metrics-changed', listener: () => void) {
    const entries = this.listeners.get(event) ?? new Set();
    entries.add(listener);
    this.listeners.set(event, entries);
  }

  off(event: 'display-added' | 'display-removed' | 'display-metrics-changed', listener: () => void) {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: 'display-added' | 'display-removed' | 'display-metrics-changed') {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, entries) => total + entries.size, 0);
  }
}

class FakeWindow implements CustomerWindow {
  readonly handlers = new Map<string, (...args: unknown[]) => void>();
  readonly sent: Array<{ channel: string; payload: unknown }> = [];
  shown = false;
  closed = false;
  loaded: { kind: 'url' | 'file'; value: string; options?: Record<string, unknown> } | null = null;
  openHandler: (() => { action: 'deny' }) | null = null;

  webContents = {
    send: (channel: string, payload: unknown) => {
      this.sent.push({ channel, payload });
    },
    setWindowOpenHandler: (handler: () => { action: 'deny' }) => {
      this.openHandler = handler;
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      this.handlers.set(event, listener);
    }
  };

  once(event: string, listener: (...args: unknown[]) => void): void {
    this.handlers.set(event, listener);
  }

  show(): void {
    this.shown = true;
  }

  close(): void {
    this.closed = true;
    this.handlers.get('closed')?.();
  }

  loadURL(value: string): Promise<void> {
    this.loaded = { kind: 'url', value };
    return Promise.resolve();
  }

  loadFile(value: string, options?: Record<string, unknown>): Promise<void> {
    this.loaded = { kind: 'file', value, options };
    return Promise.resolve();
  }

  emit(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.(...args);
  }
}

class FakeWindows implements CustomerWindowFactory {
  readonly created: Array<{ options: CustomerWindowOptions; window: FakeWindow }> = [];

  create(options: CustomerWindowOptions): CustomerWindow {
    const window = new FakeWindow();
    this.created.push({ options, window });
    return window;
  }
}

function createManager(screen: FakeScreen, windows = new FakeWindows()) {
  return {
    manager: new WiredDisplayManager({
      screen,
      windows,
      broker: new LatestFrameBroker(),
      customerPreloadPath: 'C:\\app\\preload\\display.js',
      rendererEntry: 'C:\\app\\renderer\\index.html'
    }),
    windows
  };
}

describe('WiredDisplayManager discovery', () => {
  it('classifies primary/internal displays and sorts external candidates deterministically', () => {
    const screen = new FakeScreen([
      display(1, 0, { label: 'Laptop', internal: true }),
      display(3, 3840, { label: 'External B' }),
      display(2, 1920, { label: 'External A' })
    ]);
    const { manager } = createManager(screen);

    expect(manager.listTargets().map((target) => [target.id, target.primary, target.internal])).toEqual([
      [2, false, false],
      [3, false, false],
      [1, true, true]
    ]);
    expect(manager.listTargets()[0]!.fingerprint).toContain('v1:');
  });

  it('matches the same physical display after its numeric Electron ID changes', async () => {
    const original = display(7, 1920, { label: 'Customer Panel' });
    const screen = new FakeScreen([display(1, 0, { internal: true }), original]);
    const { manager, windows } = createManager(screen);
    const fingerprint = manager.listTargets().find((target) => target.id === 7)!.fingerprint;
    screen.displays = [display(1, 0, { internal: true }), display(99, 1920, { label: 'Customer Panel' })];

    await expect(manager.open(fingerprint)).resolves.toMatchObject({ state: 'active' });
    expect(windows.created[0]!.options.bounds.x).toBe(1920);
  });

  it('falls back to prior geometry if stable monitor properties changed', async () => {
    const screen = new FakeScreen([display(5, 1920, { label: 'Panel A' })]);
    const { manager } = createManager(screen);
    const fingerprint = manager.listTargets()[0]!.fingerprint;
    screen.displays = [display(12, 1920, { label: 'Panel Renamed', scaleFactor: 1.25 })];

    await expect(manager.open(fingerprint)).resolves.toMatchObject({ state: 'active' });
  });

  it('reports ambiguity for identical candidates instead of guessing', async () => {
    const original = display(5, 1920, { label: 'Twin Panel' });
    const screen = new FakeScreen([original]);
    const { manager, windows } = createManager(screen);
    const fingerprint = manager.listTargets()[0]!.fingerprint;
    screen.displays = [
      display(8, 0, { label: 'Twin Panel' }),
      display(9, 3840, { label: 'Twin Panel' })
    ];

    await expect(manager.open(fingerprint)).resolves.toMatchObject({ state: 'ambiguous' });
    expect(windows.created).toHaveLength(0);
  });

  it('reports a removed preferred display as missing', async () => {
    const screen = new FakeScreen([display(5, 1920)]);
    const { manager } = createManager(screen);
    const fingerprint = manager.listTargets()[0]!.fingerprint;
    screen.displays = [];
    await expect(manager.open(fingerprint)).resolves.toMatchObject({ state: 'missing' });
  });
});

describe('WiredDisplayManager window lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());

  it('creates a secure hidden kiosk, blocks navigation, then shows only when ready', async () => {
    const screen = new FakeScreen([display(2, 1920)]);
    const { manager, windows } = createManager(screen);
    await manager.open(manager.listTargets()[0]!.fingerprint);
    const created = windows.created[0]!;

    expect(created.options).toMatchObject({
      frame: false,
      kiosk: true,
      skipTaskbar: true,
      show: false,
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        preload: 'C:\\app\\preload\\display.js'
      }
    });
    expect(created.window.loaded).toMatchObject({
      kind: 'file',
      options: { query: { surface: 'customer' } }
    });
    expect(created.window.shown).toBe(false);
    expect(created.window.openHandler?.()).toEqual({ action: 'deny' });
    const preventDefault = vi.fn();
    created.window.emit('will-navigate', { preventDefault }, 'https://evil.example');
    expect(preventDefault).toHaveBeenCalled();
    created.window.emit('ready-to-show');
    expect(created.window.shown).toBe(true);
  });

  it('registers the broker sink only after load and removes it when the window closes', async () => {
    const screen = new FakeScreen([display(2, 1920)]);
    const windows = new FakeWindows();
    const broker = new LatestFrameBroker();
    const addSink = vi.spyOn(broker, 'addSink');
    const manager = new WiredDisplayManager({
      screen,
      windows,
      broker,
      customerPreloadPath: 'display.js',
      rendererEntry: 'index.html'
    });
    await manager.open(manager.listTargets()[0]!.fingerprint);
    expect(addSink).not.toHaveBeenCalled();
    windows.created[0]!.window.emit('did-finish-load');
    expect(addSink).toHaveBeenCalledTimes(1);
    windows.created[0]!.window.close();
    expect(manager.getStatus().state).toBe('closed');
  });

  it('closes on removal and reopens only when the stored match becomes unambiguous', async () => {
    const panel = display(2, 1920, { label: 'Customer Panel' });
    const screen = new FakeScreen([panel]);
    const { manager, windows } = createManager(screen);
    const fingerprint = manager.listTargets()[0]!.fingerprint;
    await manager.open(fingerprint);

    screen.displays = [];
    screen.emit('display-removed');
    expect(windows.created[0]!.window.closed).toBe(true);
    expect(manager.getStatus().state).toBe('missing');

    screen.displays = [
      display(8, 0, { label: 'Customer Panel' }),
      display(9, 3840, { label: 'Customer Panel' })
    ];
    screen.emit('display-added');
    expect(manager.getStatus().state).toBe('ambiguous');
    expect(windows.created).toHaveLength(1);

    screen.displays = [display(9, 3840, { label: 'Customer Panel' })];
    screen.emit('display-removed');
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.getStatus().state).toBe('active');
    expect(windows.created).toHaveLength(2);
  });

  it('recreates the kiosk at new bounds after display metrics change', async () => {
    const screen = new FakeScreen([display(2, 1920)]);
    const { manager, windows } = createManager(screen);
    await manager.open(manager.listTargets()[0]!.fingerprint);

    screen.displays = [display(2, 2560, { bounds: { x: 2560, y: 0, width: 1920, height: 1080 } })];
    screen.emit('display-metrics-changed');
    await vi.advanceTimersByTimeAsync(0);

    expect(windows.created[0]!.window.closed).toBe(true);
    expect(windows.created[1]!.options.bounds.x).toBe(2560);
    expect(manager.getStatus().state).toBe('active');
  });

  it('shows a short-lived numbered identify overlay and disposes screen listeners', async () => {
    const screen = new FakeScreen([display(2, 1920)]);
    const { manager, windows } = createManager(screen);
    const fingerprint = manager.listTargets()[0]!.fingerprint;
    const identify = manager.identify(fingerprint);
    expect(windows.created[0]!.options).toMatchObject({ kind: 'identify', alwaysOnTop: true });
    expect(windows.created[0]!.window.loaded?.value).toContain('display=1');
    await vi.advanceTimersByTimeAsync(1_500);
    await identify;
    expect(windows.created[0]!.window.closed).toBe(true);

    expect(screen.listenerCount()).toBe(3);
    manager.dispose();
    expect(screen.listenerCount()).toBe(0);
  });
});
