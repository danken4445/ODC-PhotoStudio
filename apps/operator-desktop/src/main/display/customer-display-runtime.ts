import fs from 'node:fs';
import {
  DisplayOverviewSchema,
  DisplaySettingsSchema,
  type CustomerDisplaySnapshot,
  type DisplayOverview,
  type DisplaySettings,
  type DisplayTarget,
  type PrivateNetworkInterface,
  type TabletDisplayStatus,
  type WiredDisplayStatus
} from '@odc-photostudio/contracts';
import { CustomerDisplayCoordinator } from './customer-display-coordinator.js';
import { LatestFrameBroker } from './frame-broker.js';
import { listPrivateIpv4Interfaces } from './private-network.js';

export interface RuntimeCaptureResult {
  assetId: string;
  frameIndex: number;
  captureState: string;
}

export interface RuntimeApproveResult {
  sessionId: string;
  captureState: string;
  compositeState: string;
  uploadState: string;
}

interface RuntimeOrchestrator {
  captureFrame(params: { sessionId: string; frameIndex: number }): Promise<{
    session: { capture_state: string };
    capture: { assetId: string; frameIndex: number; localFilePath: string };
  }>;
  approveAndCompositeSession(params: { sessionId: string }): Promise<{
    session: {
      session_id: string;
      capture_state: string;
      composite_state: string;
      upload_state: string;
    };
  }>;
}

interface RuntimeCamera {
  startLiveView(onFrame: (jpeg: Uint8Array) => void): Promise<void>;
  stopLiveView(): Promise<void>;
}

interface RuntimeWired {
  listTargets(): DisplayTarget[];
  identify(fingerprint: string): Promise<void>;
  open(fingerprint: string): Promise<WiredDisplayStatus>;
  close(): void;
  getStatus(): WiredDisplayStatus;
  onStatus(listener: (status: WiredDisplayStatus) => void): () => void;
  dispose(): void;
}

interface RuntimeTablet {
  start(options: { host: string; port: number; rendererRoot: string }): Promise<TabletDisplayStatus>;
  stop(): Promise<void>;
  resetPairing(): TabletDisplayStatus;
  getStatus(): TabletDisplayStatus;
  onStatus(listener: (status: TabletDisplayStatus) => void): () => void;
}

export interface CustomerDisplayRuntimeOptions {
  orchestrator: RuntimeOrchestrator;
  camera: RuntimeCamera;
  broker: LatestFrameBroker;
  wired: RuntimeWired;
  tablet: RuntimeTablet;
  rendererRoot: string;
  loadSettings: () => DisplaySettings;
  saveSettings: (settings: DisplaySettings) => DisplaySettings;
  listInterfaces?: () => PrivateNetworkInterface[];
  readPreview?: (localFilePath: string) => Uint8Array;
}

const WIRED_CONSUMER = 'wired';
const TABLET_CONSUMER = 'tablet';

export class CustomerDisplayRuntime {
  private readonly orchestrator: RuntimeOrchestrator;
  private readonly broker: LatestFrameBroker;
  private readonly wired: RuntimeWired;
  private readonly tablet: RuntimeTablet;
  private readonly rendererRoot: string;
  private readonly loadSettings: () => DisplaySettings;
  private readonly persistSettings: (settings: DisplaySettings) => DisplaySettings;
  private readonly listInterfaces: () => PrivateNetworkInterface[];
  private readonly readPreview: (localFilePath: string) => Uint8Array;
  private readonly coordinator: CustomerDisplayCoordinator;
  private readonly activeConsumers = new Set<string>();
  private readonly inflight = new Set<Promise<void>>();
  private readonly statusListeners = new Set<(overview: DisplayOverview) => void>();
  private unsubscribers: Array<() => void> = [];
  private settings: DisplaySettings;
  private closed = false;

  constructor(options: CustomerDisplayRuntimeOptions) {
    this.orchestrator = options.orchestrator;
    this.broker = options.broker;
    this.wired = options.wired;
    this.tablet = options.tablet;
    this.rendererRoot = options.rendererRoot;
    this.loadSettings = options.loadSettings;
    this.persistSettings = options.saveSettings;
    this.listInterfaces = options.listInterfaces ?? (() => listPrivateIpv4Interfaces());
    this.readPreview = options.readPreview ?? ((filePath) => fs.readFileSync(filePath));
    this.settings = DisplaySettingsSchema.parse({});
    const camera = options.camera;
    this.coordinator = new CustomerDisplayCoordinator({
      broker: this.broker,
      liveView: {
        startLiveView: (onFrame) => camera.startLiveView(onFrame),
        stopLiveView: () => camera.stopLiveView()
      }
    });
  }

  public async initialize(): Promise<void> {
    this.settings = this.loadSettings();
    this.unsubscribers = [
      this.wired.onStatus(() => this.onTransportStatus()),
      this.tablet.onStatus(() => this.onTransportStatus())
    ];
    await this.applySettings(this.settings);
    await this.syncConsumers();
  }

  public getSnapshot(): CustomerDisplaySnapshot {
    return this.coordinator.getSnapshot();
  }

  public getOverview(): DisplayOverview {
    return DisplayOverviewSchema.parse({
      settings: this.settings,
      targets: this.wired.listTargets(),
      interfaces: this.listInterfaces(),
      wired: this.wired.getStatus(),
      tablet: this.tablet.getStatus(),
      metrics: this.broker.getMetrics()
    });
  }

  public onStatus(listener: (overview: DisplayOverview) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  public beginSession(input: { sessionId: string; shotCount: number }): void {
    this.coordinator.beginSession(input);
  }

  /**
   * Must call the coordinator synchronously so the countdown starts in the same tick
   * and a concurrent request is rejected as DISPLAY_CAPTURE_BUSY.
   */
  public captureFrame(params: { sessionId: string; frameIndex: number }): Promise<RuntimeCaptureResult> {
    return this.coordinator.runCapture<RuntimeCaptureResult>({
      sessionId: params.sessionId,
      frameIndex: params.frameIndex,
      capture: async () => {
        const { session, capture } = await this.orchestrator.captureFrame({
          sessionId: params.sessionId,
          frameIndex: params.frameIndex
        });
        let previewJpeg: Uint8Array | null = null;
        try {
          previewJpeg = this.readPreview(capture.localFilePath);
        } catch {
          // The shot is already durable; an unreadable preview must not fail the capture.
        }
        return {
          result: {
            assetId: capture.assetId,
            frameIndex: capture.frameIndex,
            captureState: session.capture_state
          },
          previewJpeg,
          allCaptured: session.capture_state === 'reviewing'
        };
      }
    });
  }

  public async approveSession(sessionId: string): Promise<RuntimeApproveResult> {
    const { session } = await this.orchestrator.approveAndCompositeSession({ sessionId });
    try {
      this.coordinator.approveSession(sessionId);
    } catch {
      // Display problems never block approval, printing, or sync.
    }
    return {
      sessionId: session.session_id,
      captureState: session.capture_state,
      compositeState: session.composite_state,
      uploadState: session.upload_state
    };
  }

  public resetSession(): void {
    this.coordinator.resetSession();
  }

  public resetCustomerSession(): void {
    this.resetSession();
  }

  public async saveSettings(next: DisplaySettings): Promise<DisplayOverview> {
    this.settings = this.persistSettings(DisplaySettingsSchema.parse(next));
    await this.applySettings(this.settings);
    await this.syncConsumers();
    return this.getOverview();
  }

  public async identifyDisplay(fingerprint: string): Promise<void> {
    await this.wired.identify(fingerprint);
  }

  public async openWiredDisplay(fingerprint: string): Promise<DisplayOverview> {
    await this.wired.open(fingerprint);
    return this.getOverview();
  }

  public closeWiredDisplay(): DisplayOverview {
    this.wired.close();
    return this.getOverview();
  }

  public async startTabletDisplay(host: string, port: number): Promise<DisplayOverview> {
    await this.tablet.start({ host, port, rendererRoot: this.rendererRoot });
    return this.getOverview();
  }

  public async stopTabletDisplay(): Promise<DisplayOverview> {
    await this.tablet.stop();
    return this.getOverview();
  }

  public resetTabletPairing(): DisplayOverview {
    this.tablet.resetPairing();
    return this.getOverview();
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    this.statusListeners.clear();
    await Promise.allSettled([...this.inflight]);
    await this.coordinator.close().catch(() => undefined);
    this.wired.dispose();
    await this.tablet.stop().catch(() => undefined);
  }

  private async applySettings(settings: DisplaySettings): Promise<void> {
    this.coordinator.setMirroredLiveView(settings.mirroredLiveView);
    const wantsWired = settings.mode === 'wired' || settings.mode === 'both';
    const wantsTablet = settings.mode === 'tablet' || settings.mode === 'both';

    if (wantsWired && settings.preferredWiredDisplay) {
      await this.wired.open(settings.preferredWiredDisplay.fingerprint).catch(() => undefined);
    } else {
      this.wired.close();
    }

    if (wantsTablet && settings.tabletBindAddress) {
      await this.tablet
        .start({
          host: settings.tabletBindAddress,
          port: settings.tabletPort,
          rendererRoot: this.rendererRoot
        })
        .catch(() => undefined);
    } else {
      await this.tablet.stop().catch(() => undefined);
    }
  }

  private onTransportStatus(): void {
    if (this.closed) return;
    const pending = this.syncConsumers();
    this.inflight.add(pending);
    void pending.finally(() => this.inflight.delete(pending));
    const overview = this.getOverview();
    for (const listener of this.statusListeners) listener(overview);
  }

  /**
   * A transport is a live-view consumer only while it can actually show frames.
   * Removals are applied synchronously so the coordinator's stop grace period starts immediately.
   */
  private syncConsumers(): Promise<void> {
    const desired = new Map<string, boolean>([
      [WIRED_CONSUMER, this.wired.getStatus().state === 'active'],
      [TABLET_CONSUMER, this.tablet.getStatus().state === 'paired']
    ]);
    const starts: Array<Promise<void>> = [];
    for (const [id, wanted] of desired) {
      const active = this.activeConsumers.has(id);
      if (wanted && !active) {
        this.activeConsumers.add(id);
        starts.push(
          this.coordinator
            .addConsumer(id)
            .then(() => this.coordinator.setCameraReady(true))
            .catch(() => {
              this.activeConsumers.delete(id);
              this.coordinator.removeConsumer(id);
              try {
                this.coordinator.setCameraReady(false);
              } catch {
                // coordinator already closed
              }
            })
        );
      } else if (!wanted && active) {
        this.activeConsumers.delete(id);
        this.coordinator.removeConsumer(id);
      }
    }
    return Promise.all(starts).then(() => undefined);
  }
}
