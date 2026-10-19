import type {
  DisplayTarget,
  WiredDisplayStatus,
  CustomerDisplaySnapshot
} from '@odc-photostudio/contracts';
import { SECURITY_WINDOW_PREFERENCES } from '../window-security.js';
import type {
  CustomerDisplayFrame,
  DisplaySink,
  LatestFrameBroker
} from './frame-broker.js';

type DisplayEvent = 'display-added' | 'display-removed' | 'display-metrics-changed';

export interface ElectronDisplayLike {
  id: number;
  label?: string;
  bounds: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
  scaleFactor: number;
  rotation: number;
  internal?: boolean;
}

export interface ElectronScreenAdapter {
  getAllDisplays(): ElectronDisplayLike[];
  getPrimaryDisplay(): ElectronDisplayLike;
  on(event: DisplayEvent, listener: () => void): void;
  off(event: DisplayEvent, listener: () => void): void;
}

export interface CustomerWindowOptions {
  kind: 'customer' | 'identify';
  bounds: { x: number; y: number; width: number; height: number };
  backgroundColor: string;
  frame: boolean;
  kiosk: boolean;
  skipTaskbar: boolean;
  show: boolean;
  alwaysOnTop?: boolean;
  webPreferences: typeof SECURITY_WINDOW_PREFERENCES & { preload?: string };
}

export interface CustomerWindow {
  webContents: {
    send(channel: string, payload: unknown): void;
    setWindowOpenHandler(handler: () => { action: 'deny' }): void;
    on(event: string, listener: (...args: any[]) => void): void;
  };
  once(event: string, listener: (...args: any[]) => void): void;
  show(): void;
  close(): void;
  loadURL(url: string): Promise<void>;
  loadFile(filePath: string, options?: Record<string, unknown>): Promise<void>;
}

export interface CustomerWindowFactory {
  create(options: CustomerWindowOptions): CustomerWindow;
}

interface WiredDisplayManagerOptions {
  screen: ElectronScreenAdapter;
  windows: CustomerWindowFactory;
  broker: LatestFrameBroker;
  customerPreloadPath: string;
  rendererEntry: string;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

interface ParsedFingerprint {
  stableKey: string;
  geometryKey: string;
}

interface DisplayMatch {
  state: 'match' | 'missing' | 'ambiguous';
  target?: DisplayTarget;
}

const SCREEN_EVENTS: DisplayEvent[] = [
  'display-added',
  'display-removed',
  'display-metrics-changed'
];

function stableKey(display: ElectronDisplayLike): string {
  return [
    encodeURIComponent(display.label?.trim() || 'Unknown display'),
    `${display.size.width}x${display.size.height}`,
    String(display.scaleFactor),
    String(display.rotation),
    display.internal ? 'internal' : 'external'
  ].join('|');
}

function geometryKey(display: ElectronDisplayLike): string {
  const { x, y, width, height } = display.bounds;
  return `${x},${y},${width},${height}`;
}

function createFingerprint(display: ElectronDisplayLike): string {
  return `v1:${stableKey(display)}|${geometryKey(display)}`;
}

function parseFingerprint(fingerprint: string): ParsedFingerprint | null {
  if (!fingerprint.startsWith('v1:')) return null;
  const parts = fingerprint.slice(3).split('|');
  if (parts.length !== 6) return null;
  return {
    stableKey: parts.slice(0, 5).join('|'),
    geometryKey: parts[5]!
  };
}

export class WiredDisplayManager {
  private readonly screen: ElectronScreenAdapter;
  private readonly windows: CustomerWindowFactory;
  private readonly broker: LatestFrameBroker;
  private readonly customerPreloadPath: string;
  private readonly rendererEntry: string;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly statusListeners = new Set<(status: WiredDisplayStatus) => void>();
  private readonly handleDisplayChange = () => this.reconcilePreferredDisplay();
  private status: WiredDisplayStatus = {
    state: 'closed',
    selectedFingerprint: null,
    error: null
  };
  private preferredFingerprint: string | null = null;
  private customerWindow: CustomerWindow | null = null;
  private activeTargetKey: string | null = null;
  private removeBrokerSink: (() => void) | null = null;
  private identifyTimers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(options: WiredDisplayManagerOptions) {
    this.screen = options.screen;
    this.windows = options.windows;
    this.broker = options.broker;
    this.customerPreloadPath = options.customerPreloadPath;
    this.rendererEntry = options.rendererEntry;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    for (const event of SCREEN_EVENTS) this.screen.on(event, this.handleDisplayChange);
  }

  public listTargets(): DisplayTarget[] {
    const primaryId = this.screen.getPrimaryDisplay()?.id;
    return this.screen
      .getAllDisplays()
      .map((display) => this.toTarget(display, primaryId))
      .sort(
        (left, right) =>
          Number(left.internal) - Number(right.internal) ||
          left.bounds.x - right.bounds.x ||
          left.bounds.y - right.bounds.y ||
          left.label.localeCompare(right.label) ||
          left.id - right.id
      );
  }

  public async identify(fingerprint: string): Promise<void> {
    this.assertActive();
    const match = this.resolveFingerprint(fingerprint);
    if (match.state !== 'match' || !match.target) {
      throw new Error(match.state === 'ambiguous' ? 'DISPLAY_TARGET_AMBIGUOUS' : 'DISPLAY_TARGET_MISSING');
    }
    const position = this.listTargets().findIndex((target) => target.id === match.target!.id) + 1;
    const overlay = this.windows.create({
      kind: 'identify',
      bounds: match.target.bounds,
      backgroundColor: '#09090B',
      frame: false,
      kiosk: false,
      skipTaskbar: true,
      show: true,
      alwaysOnTop: true,
      webPreferences: { ...SECURITY_WINDOW_PREFERENCES }
    });
    overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const html = encodeURIComponent(
      `<!doctype html><meta charset="utf-8"><style>body{margin:0;display:grid;place-items:center;height:100vh;background:#09090b;color:white;font:900 36vw system-ui}</style><div>${position}</div>`
    );
    await overlay.loadURL(`data:text/html,${html}#display=${position}`);
    await new Promise<void>((resolve) => {
      const timer = this.setTimeoutFn(() => {
        this.identifyTimers.delete(timer);
        overlay.close();
        resolve();
      }, 1_500);
      this.identifyTimers.add(timer);
    });
  }

  public async open(fingerprint: string): Promise<WiredDisplayStatus> {
    this.assertActive();
    this.preferredFingerprint = fingerprint;
    const match = this.resolveFingerprint(fingerprint);
    if (match.state !== 'match' || !match.target) {
      this.closeWindow();
      return this.publishStatus({
        state: match.state === 'ambiguous' ? 'ambiguous' : 'missing',
        selectedFingerprint: fingerprint,
        error: null
      });
    }
    await this.openTarget(match.target, fingerprint);
    return this.status;
  }

  public close(): void {
    this.preferredFingerprint = null;
    this.closeWindow();
    this.publishStatus({ state: 'closed', selectedFingerprint: null, error: null });
  }

  public getStatus(): WiredDisplayStatus {
    return this.status;
  }

  public onStatus(listener: (status: WiredDisplayStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  public ackSnapshot(revision: number): void {
    this.broker.ackSnapshot('wired', revision);
  }

  public ackFrame(sequence: number): void {
    this.broker.ackFrame('wired', sequence);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const event of SCREEN_EVENTS) this.screen.off(event, this.handleDisplayChange);
    for (const timer of this.identifyTimers) this.clearTimeoutFn(timer);
    this.identifyTimers.clear();
    this.preferredFingerprint = null;
    this.closeWindow();
    this.statusListeners.clear();
  }

  private toTarget(display: ElectronDisplayLike, primaryId: number | undefined): DisplayTarget {
    return {
      fingerprint: createFingerprint(display),
      id: display.id,
      label: display.label?.trim() || `Display ${display.id}`,
      bounds: { ...display.bounds },
      size: { ...display.size },
      scaleFactor: display.scaleFactor,
      rotation: display.rotation,
      internal: Boolean(display.internal),
      primary: display.id === primaryId
    };
  }

  private resolveFingerprint(fingerprint: string): DisplayMatch {
    const parsed = parseFingerprint(fingerprint);
    if (!parsed) return { state: 'missing' };
    const targets = this.listTargets();
    const stableMatches = targets.filter((target) => {
      const current = this.screen.getAllDisplays().find((display) => display.id === target.id);
      return current ? stableKey(current) === parsed.stableKey : false;
    });
    if (stableMatches.length === 1) return { state: 'match', target: stableMatches[0] };
    if (stableMatches.length > 1) {
      const geometryMatches = stableMatches.filter(
        (target) => geometryKey(target) === parsed.geometryKey
      );
      return geometryMatches.length === 1
        ? { state: 'match', target: geometryMatches[0] }
        : { state: 'ambiguous' };
    }
    const geometryMatches = targets.filter((target) => geometryKey(target) === parsed.geometryKey);
    if (geometryMatches.length === 1) return { state: 'match', target: geometryMatches[0] };
    return { state: geometryMatches.length > 1 ? 'ambiguous' : 'missing' };
  }

  private async openTarget(target: DisplayTarget, fingerprint: string): Promise<void> {
    this.closeWindow();
    this.publishStatus({ state: 'opening', selectedFingerprint: fingerprint, error: null });
    const window = this.windows.create({
      kind: 'customer',
      bounds: target.bounds,
      backgroundColor: '#08090B',
      frame: false,
      kiosk: true,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        ...SECURITY_WINDOW_PREFERENCES,
        preload: this.customerPreloadPath
      }
    });
    this.customerWindow = window;
    this.activeTargetKey = `${target.id}:${geometryKey(target)}`;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event: { preventDefault(): void }, navigationUrl: string) => {
      if (!this.isAllowedNavigation(navigationUrl)) event.preventDefault();
    });
    window.webContents.on('did-finish-load', () => {
      if (this.customerWindow !== window) return;
      this.removeBrokerSink?.();
      this.removeBrokerSink = this.broker.addSink(this.createSink(window));
    });
    window.once('ready-to-show', () => {
      if (this.customerWindow === window) window.show();
    });
    window.once('closed', () => {
      if (this.customerWindow !== window) return;
      this.customerWindow = null;
      this.activeTargetKey = null;
      this.removeBrokerSink?.();
      this.removeBrokerSink = null;
      this.publishStatus({
        state: 'closed',
        selectedFingerprint: this.preferredFingerprint,
        error: null
      });
    });
    if (/^https?:\/\//.test(this.rendererEntry)) {
      const url = new URL(this.rendererEntry);
      url.searchParams.set('surface', 'customer');
      await window.loadURL(url.toString());
    } else {
      await window.loadFile(this.rendererEntry, { query: { surface: 'customer' } });
    }
    this.publishStatus({ state: 'active', selectedFingerprint: fingerprint, error: null });
  }

  private createSink(window: CustomerWindow): DisplaySink {
    return {
      id: 'wired',
      offerSnapshot: (snapshot: CustomerDisplaySnapshot) => {
        window.webContents.send('odc:display:snapshot', snapshot);
        return true;
      },
      offerFrame: (frame: CustomerDisplayFrame) => {
        window.webContents.send('odc:display:frame', frame);
        return true;
      },
      disconnect: (reason: string) => {
        this.closeWindow();
        this.publishStatus({
          state: 'error',
          selectedFingerprint: this.preferredFingerprint,
          error: reason
        });
      }
    };
  }

  private reconcilePreferredDisplay(): void {
    if (!this.preferredFingerprint || this.disposed) return;
    const match = this.resolveFingerprint(this.preferredFingerprint);
    if (match.state !== 'match' || !match.target) {
      this.closeWindow();
      this.publishStatus({
        state: match.state === 'ambiguous' ? 'ambiguous' : 'missing',
        selectedFingerprint: this.preferredFingerprint,
        error: null
      });
      return;
    }
    const nextTargetKey = `${match.target.id}:${geometryKey(match.target)}`;
    if (this.customerWindow && this.activeTargetKey === nextTargetKey) return;
    if (this.customerWindow) this.closeWindow();
    void this.openTarget(match.target, this.preferredFingerprint).catch((error: unknown) => {
      this.publishStatus({
        state: 'error',
        selectedFingerprint: this.preferredFingerprint,
        error: error instanceof Error ? error.message : 'DISPLAY_WINDOW_OPEN_FAILED'
      });
    });
  }

  private isAllowedNavigation(url: string): boolean {
    if (/^https?:\/\//.test(this.rendererEntry)) return url.startsWith(this.rendererEntry);
    return url.startsWith('file://');
  }

  private closeWindow(): void {
    const window = this.customerWindow;
    this.customerWindow = null;
    this.activeTargetKey = null;
    this.removeBrokerSink?.();
    this.removeBrokerSink = null;
    window?.close();
  }

  private publishStatus(status: WiredDisplayStatus): WiredDisplayStatus {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
    return status;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('WIRED_DISPLAY_MANAGER_DISPOSED');
  }
}
