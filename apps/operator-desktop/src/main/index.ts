import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, screen, session as electronSession } from 'electron';
import { z } from 'zod';
import {
  CreateSessionIpcRequestSchema,
  DisplayFingerprintIpcRequestSchema,
  DisplayOverviewSchema,
  SaveDisplaySettingsIpcRequestSchema,
  StartTabletDisplayIpcRequestSchema,
  ResolveUnknownPrintIpcRequestSchema,
  SubmitPrintIpcRequestSchema,
  TriggerCaptureIpcRequestSchema,
  type DisplayOverview,
  type DisplaySettings,
  type UploadState
} from '@odc-photostudio/contracts';
import { StationOrchestrator } from './orchestrator.js';
import { HttpCloudSyncTransport } from './queue/http-transport.js';
import { MockCameraProvider, type ICameraProvider } from './camera/provider.js';
import { RealCameraProvider } from './camera/real-camera-provider.js';
import { MockPrinterProvider, type IPrinterProvider } from './printer/provider.js';
import { WindowsSpoolerPrinterProvider } from './printer/windows-spooler-provider.js';
import { CustomerDisplayRuntime } from './display/customer-display-runtime.js';
import { loadDisplaySettings, saveDisplaySettings } from './display/display-settings.js';
import { LatestFrameBroker } from './display/frame-broker.js';
import { TabletDisplayServer } from './display/tablet-display-server.js';
import {
  WiredDisplayManager,
  type CustomerWindow,
  type ElectronScreenAdapter
} from './display/wired-display-manager.js';
import {
  CONTENT_SECURITY_POLICY,
  SECURITY_WINDOW_PREFERENCES
} from './window-security.js';

export { CONTENT_SECURITY_POLICY, SECURITY_WINDOW_PREFERENCES } from './window-security.js';

function safeHandle(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, listener);
}

export interface CustomerDisplayControlService {
  getOverview(): DisplayOverview | Promise<DisplayOverview>;
  saveSettings(settings: DisplaySettings): DisplayOverview | Promise<DisplayOverview>;
  identifyDisplay(fingerprint: string): void | Promise<void>;
  openWiredDisplay(fingerprint: string): DisplayOverview | Promise<DisplayOverview>;
  closeWiredDisplay(): DisplayOverview | Promise<DisplayOverview>;
  startTabletDisplay(host: string, port: number): DisplayOverview | Promise<DisplayOverview>;
  stopTabletDisplay(): DisplayOverview | Promise<DisplayOverview>;
  resetTabletPairing(): DisplayOverview | Promise<DisplayOverview>;
  resetCustomerSession(): void | Promise<void>;
  onStatus(listener: (overview: DisplayOverview) => void): () => void;
  beginSession?(input: { sessionId: string; shotCount: number }): void;
  captureFrame?(params: {
    sessionId: string;
    frameIndex: number;
  }): Promise<{ assetId: string; frameIndex: number; captureState: string }>;
  approveSession?(sessionId: string): Promise<{
    sessionId: string;
    captureState: string;
    compositeState: string;
    uploadState: string;
  }>;
}

function registerDisplayIpcHandlers(service: CustomerDisplayControlService): void {
  safeHandle('odc:display:get-overview', async (_event, rawPayload: unknown) => {
    z.undefined().parse(rawPayload);
    return DisplayOverviewSchema.parse(await service.getOverview());
  });
  safeHandle('odc:display:save-settings', async (_event, rawPayload: unknown) => {
    const settings = SaveDisplaySettingsIpcRequestSchema.parse(rawPayload);
    return DisplayOverviewSchema.parse(await service.saveSettings(settings));
  });
  safeHandle('odc:display:identify', async (_event, rawPayload: unknown) => {
    const { fingerprint } = DisplayFingerprintIpcRequestSchema.parse(rawPayload);
    await service.identifyDisplay(fingerprint);
  });
  safeHandle('odc:display:open-wired', async (_event, rawPayload: unknown) => {
    const { fingerprint } = DisplayFingerprintIpcRequestSchema.parse(rawPayload);
    return DisplayOverviewSchema.parse(await service.openWiredDisplay(fingerprint));
  });
  safeHandle('odc:display:close-wired', async (_event, rawPayload: unknown) => {
    z.undefined().parse(rawPayload);
    return DisplayOverviewSchema.parse(await service.closeWiredDisplay());
  });
  safeHandle('odc:display:start-tablet', async (_event, rawPayload: unknown) => {
    const { host, port } = StartTabletDisplayIpcRequestSchema.parse(rawPayload);
    return DisplayOverviewSchema.parse(await service.startTabletDisplay(host, port));
  });
  safeHandle('odc:display:stop-tablet', async (_event, rawPayload: unknown) => {
    z.undefined().parse(rawPayload);
    return DisplayOverviewSchema.parse(await service.stopTabletDisplay());
  });
  safeHandle('odc:display:reset-pairing', async (_event, rawPayload: unknown) => {
    z.undefined().parse(rawPayload);
    return DisplayOverviewSchema.parse(await service.resetTabletPairing());
  });
  safeHandle('odc:display:reset-session', async (_event, rawPayload: unknown) => {
    z.undefined().parse(rawPayload);
    await service.resetCustomerSession();
  });

  const subscriptions = new Map<number, () => void>();
  const unsubscribe = (senderId: number) => {
    subscriptions.get(senderId)?.();
    subscriptions.delete(senderId);
  };
  ipcMain.removeAllListeners('odc:display:status-subscribe');
  ipcMain.removeAllListeners('odc:display:status-unsubscribe');
  ipcMain.on('odc:display:status-subscribe', (event) => {
    unsubscribe(event.sender.id);
    const stop = service.onStatus((overview) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('odc:display:status', DisplayOverviewSchema.parse(overview));
      }
    });
    subscriptions.set(event.sender.id, stop);
    event.sender.once('destroyed', () => unsubscribe(event.sender.id));
  });
  ipcMain.on('odc:display:status-unsubscribe', (event) => unsubscribe(event.sender.id));
}

export function registerValidatedIpcHandlers(
  orchestrator: StationOrchestrator,
  httpTransport?: HttpCloudSyncTransport,
  displayControl?: CustomerDisplayControlService
): void {
  safeHandle('odc:preflight:status', (_event, rawPayload: unknown) => {
    const { eventId } = z.object({ eventId: z.string().uuid() }).parse(rawPayload);
    return orchestrator.evaluatePreflight(eventId);
  });

  safeHandle('odc:session:start', (_event, rawPayload: unknown) => {
    const req = CreateSessionIpcRequestSchema.parse(rawPayload);
    const { session } = orchestrator.startSession({
      eventId: req.eventId,
      templateVersionId: req.templateVersionId
    });
    displayControl?.beginSession?.({
      sessionId: session.session_id,
      shotCount: orchestrator.getTemplateRequiredShotCount(req.eventId, req.templateVersionId)
    });
    return { sessionId: session.session_id };
  });

  safeHandle('odc:session:capture', async (_event, rawPayload: unknown) => {
    const req = TriggerCaptureIpcRequestSchema.parse(rawPayload);
    if (displayControl?.captureFrame) {
      return displayControl.captureFrame({ sessionId: req.sessionId, frameIndex: req.frameIndex });
    }
    const { session, capture } = await orchestrator.captureFrame({
      sessionId: req.sessionId,
      frameIndex: req.frameIndex
    });
    return {
      assetId: capture.assetId,
      frameIndex: capture.frameIndex,
      captureState: session.capture_state
    };
  });

  safeHandle('odc:session:approve', async (_event, rawPayload: unknown) => {
    const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(rawPayload);
    if (displayControl?.approveSession) {
      return displayControl.approveSession(sessionId);
    }
    const { session } = await orchestrator.approveAndCompositeSession({ sessionId });
    return {
      sessionId: session.session_id,
      captureState: session.capture_state,
      compositeState: session.composite_state,
      uploadState: session.upload_state
    };
  });

  safeHandle('odc:print:submit', async (_event, rawPayload: unknown) => {
    const req = SubmitPrintIpcRequestSchema.parse(rawPayload);
    const { attempt, result } = await orchestrator.submitPrint({
      sessionId: req.sessionId,
      printProfileId: req.printProfileId,
      copies: req.copies,
      isReprint: req.isReprint
    });
    return {
      attemptId: attempt.attempt_id,
      state: attempt.state,
      displayMessage: result.displayMessage
    };
  });

  safeHandle('odc:print:resolve-unknown', (_event, rawPayload: unknown) => {
    const req = ResolveUnknownPrintIpcRequestSchema.parse(rawPayload);
    const updated = orchestrator.resolveUnknownPrintAttempt({
      attemptId: req.attemptId,
      resolution: req.resolution,
      operatorNote: req.operatorNote
    });
    return {
      attemptId: updated.attempt_id,
      state: updated.state
    };
  });

  // UI Queue Inspection: Returns durable queue jobs and aggregate statistics
  safeHandle('odc:sync:status', () => {
    const rows = orchestrator.db.db
      .prepare(
        `SELECT job_id, session_id, state, attempt_count, diagnostic_text, error_code, next_attempt_at, updated_at
         FROM durable_jobs
         ORDER BY created_at DESC`
      )
      .all() as Array<{
        job_id: string;
        session_id: string;
        state: string;
        attempt_count: number;
        diagnostic_text: string | null;
        error_code: string | null;
        next_attempt_at: string;
        updated_at: string;
      }>;

    const queue = rows.map((r) => ({
      jobId: r.job_id,
      sessionId: r.session_id,
      uploadState: r.state as UploadState,
      state: r.state as UploadState,
      attemptCount: r.attempt_count,
      diagnosticText: r.diagnostic_text,
      errorCode: r.error_code,
      nextAttemptAt: r.next_attempt_at,
      updatedAt: r.updated_at
    }));

    const pendingCount = rows.filter(
      (r) => r.state === 'pending' || r.state === 'retry_scheduled'
    ).length;
    const publishedCount = rows.filter((r) => r.state === 'published').length;
    const failedCount = rows.filter((r) => r.state === 'failed').length;
    const blockedAuthCount = rows.filter((r) => r.state === 'blocked_auth').length;

    return {
      queue,
      pendingCount,
      publishedCount,
      failedCount,
      blockedAuthCount
    };
  });

  // Immediate Sync Cycle Trigger: UI button or drawer manual trigger
  safeHandle('odc:sync:trigger', async () => {
    const transport = httpTransport ?? new HttpCloudSyncTransport();
    return orchestrator.syncNextPendingJob(transport);
  });

  safeHandle('odc:station:enroll', async (_event, rawPayload: unknown) => {
    const payload = z
      .object({
        serverUrl: z.string().url(),
        code: z.string().min(6),
        deviceLabel: z.string().optional()
      })
      .parse(rawPayload);
    return orchestrator.enrollStationWithCode(payload);
  });

  safeHandle('odc:station:enrollment-status', () => {
    const cfg = orchestrator.db.getStationConfigMap();
    const stationId = cfg.station_id || orchestrator.stationId;
    const tenantId = cfg.tenant_id;
    const plan = cfg.plan;
    const serverUrl = cfg.server_url;

    // Check if station has been enrolled (not empty, not default placeholder ST-01 if configured)
    const isEnrolled = Boolean(cfg.station_id || (stationId && stationId !== '30000000-0000-4000-8000-000000000001'));
    const dailyTransactionsCount = orchestrator.db.countCompletedTransactionsToday();

    // Check active grant for maxTransactionsPerDay if event package exists
    let maxTransactionsPerDay: number | null = null;
    const allPackages = orchestrator.db.db
      .prepare(`SELECT grant_json FROM cached_event_packages LIMIT 1`)
      .get() as { grant_json: string } | undefined;
    if (allPackages) {
      try {
        const grant = JSON.parse(allPackages.grant_json) as { payload?: { maxTransactionsPerDay?: number | null } };
        maxTransactionsPerDay = grant.payload?.maxTransactionsPerDay ?? null;
      } catch {
        // ignore
      }
    }

    return {
      enrolled: isEnrolled,
      stationId,
      tenantId,
      plan: plan || 'basic',
      serverUrl,
      dailyTransactionsCount,
      maxTransactionsPerDay
    };
  });

  if (displayControl) registerDisplayIpcHandlers(displayControl);
}

export function createOperatorWindow(preloadPath: string, rendererUrl: string): BrowserWindow {
  if (electronSession?.defaultSession?.webRequest) {
    electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [CONTENT_SECURITY_POLICY]
        }
      });
    });
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: '#09090B',
    title: 'ODC-PhotoStudio — Operator Capture Console',
    webPreferences: {
      ...SECURITY_WINDOW_PREFERENCES,
      preload: preloadPath
    }
  });

  // Restrict external navigation and new window creation (Section 15)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    if (
      !navigationUrl.startsWith(rendererUrl) &&
      !navigationUrl.startsWith('file://')
    ) {
      event.preventDefault();
    }
  });

  if (rendererUrl.startsWith('http://') || rendererUrl.startsWith('https://')) {
    void win.loadURL(rendererUrl);
  } else if (rendererUrl.startsWith('file://')) {
    void win.loadURL(rendererUrl);
  } else {
    void win.loadFile(rendererUrl);
  }

  return win;
}

let activeOrchestrator: StationOrchestrator | null = null;
let activeDisplayRuntime: CustomerDisplayRuntime | null = null;
let backgroundSyncTimer: NodeJS.Timeout | null = null;

export async function bootstrapMainProcess(): Promise<{
  orchestrator: StationOrchestrator;
  httpTransport: HttpCloudSyncTransport;
  window?: BrowserWindow;
}> {
  // 1. Read configuration from environment
  const dataDir =
    process.env.ODC_DATA_DIR ||
    (app?.getPath ? path.join(app.getPath('userData'), 'odc-station') : path.join(process.cwd(), 'data'));
  const stationId = process.env.ODC_STATION_ID || '30000000-0000-4000-8000-000000000001';
  const desktopMode = (process.env.ODC_DESKTOP_MODE as 'real' | 'mock') || 'mock';
  const grantPublicKeyPem = process.env.OFFLINE_GRANT_PUBLIC_KEY_PEM || '';
  const portalApiUrl = process.env.ODC_PORTAL_API_URL || 'http://localhost:3000';
  const tokenPepper = process.env.TOKEN_PEPPER_SECRET || '';

  fs.mkdirSync(dataDir, { recursive: true });

  // 2. Select Mock vs Real camera and printer providers based on ODC_DESKTOP_MODE
  let camera: ICameraProvider;
  let printer: IPrinterProvider;

  if (desktopMode === 'real') {
    camera = new RealCameraProvider({
      resolveSessionDir: (sessionId: string) => path.join(dataDir, 'sessions', sessionId)
    });
    printer = new WindowsSpoolerPrinterProvider({
      printCacheDir: path.join(dataDir, 'prints')
    });
  } else {
    camera = new MockCameraProvider((sessionId: string) =>
      path.join(dataDir, 'sessions', sessionId)
    );
    printer = new MockPrinterProvider(path.join(dataDir, 'prints'));
  }

  try {
    await camera.initialize();
  } catch (err) {
    console.warn('Camera initialization warning:', err);
  }

  // 3. Instantiate StationOrchestrator
  const orchestrator = new StationOrchestrator({
    dataDir,
    stationId,
    camera,
    printer,
    grantPublicKeyPem,
    tokenPepper
  });
  activeOrchestrator = orchestrator;

  // 4. Run Startup Reconciliation before accepting jobs or opening UI
  const reconciliationReport = orchestrator.syncEngine.runStartupReconciliation();
  console.log('Startup reconciliation completed:', reconciliationReport);

  // 5. Instantiate HttpCloudSyncTransport
  const httpTransport = new HttpCloudSyncTransport({
    baseUrl: portalApiUrl
  });

  // 6. Compose the customer display runtime (Electron-only) and register validated IPC handlers
  let displayRuntime: CustomerDisplayRuntime | undefined;
  if (app?.isReady && app.isReady()) {
    const broker = new LatestFrameBroker();
    const rendererDir = path.join(__dirname, '../renderer');
    const devRendererUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    const isDevRenderer = process.env.NODE_ENV === 'development' || !app.isPackaged;
    const wired = new WiredDisplayManager({
      screen: screen as unknown as ElectronScreenAdapter,
      windows: {
        create: (options) => new BrowserWindow(options as Electron.BrowserWindowConstructorOptions) as unknown as CustomerWindow
      },
      broker,
      customerPreloadPath: path.join(__dirname, '../preload/display.js'),
      rendererEntry: isDevRenderer ? devRendererUrl : path.join(rendererDir, 'index.html')
    });
    const tablet = new TabletDisplayServer({ broker });
    displayRuntime = new CustomerDisplayRuntime({
      orchestrator,
      camera,
      broker,
      wired,
      tablet,
      rendererRoot: rendererDir,
      loadSettings: () => loadDisplaySettings(orchestrator.db),
      saveSettings: (settings) => saveDisplaySettings(orchestrator.db, settings)
    });
    activeDisplayRuntime = displayRuntime;
    try {
      await displayRuntime.initialize();
    } catch (err) {
      // Display problems must never prevent capture, approval, printing, or sync.
      console.warn('Customer display initialization warning:', err);
    }
  }
  registerValidatedIpcHandlers(orchestrator, httpTransport, displayRuntime);

  // 7. Start background sync timer (every 3 seconds)
  if (backgroundSyncTimer) {
    clearInterval(backgroundSyncTimer);
  }
  backgroundSyncTimer = setInterval(async () => {
    try {
      await orchestrator.syncNextPendingJob(httpTransport);
    } catch {
      // transient background failures handled gracefully by sync engine
    }
  }, 3000);

  // 8. Create and load operator window
  let window: BrowserWindow | undefined;
  if (app?.isReady && app.isReady()) {
    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
    const rendererUrl =
      process.env.VITE_DEV_SERVER_URL ||
      (isDev ? 'http://localhost:5173' : path.join(__dirname, '../renderer/index.html'));
    const preloadPath = path.join(__dirname, '../preload/index.js');
    window = createOperatorWindow(preloadPath, rendererUrl);
  }

  return { orchestrator, httpTransport, window };
}

if (app && typeof app.whenReady === 'function') {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.whenReady().then(async () => {
      try {
        await bootstrapMainProcess();
      } catch (err) {
        console.error('Fatal error during application startup:', err);
        app.quit();
      }
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        if (backgroundSyncTimer) {
          clearInterval(backgroundSyncTimer);
          backgroundSyncTimer = null;
        }
        void (async () => {
          const runtime = activeDisplayRuntime;
          activeDisplayRuntime = null;
          try {
            await runtime?.close();
          } catch (err) {
            console.warn('Customer display shutdown warning:', err);
          }
          if (activeOrchestrator) {
            activeOrchestrator.close();
            activeOrchestrator = null;
          }
          app.quit();
        })();
      }
    });
  }
}

export { path };
