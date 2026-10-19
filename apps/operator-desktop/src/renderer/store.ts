import { create } from 'zustand';
import type {
  CaptureState,
  CompositeState,
  PrintAttemptState,
  UploadState
} from '@odc-photostudio/contracts';

export interface ShotSlotPreview {
  frameIndex: number;
  assetId: string | null;
  capturedAt: string | null;
  previewDataUrl: string | null;
}

export interface SyncQueueItemView {
  sessionId: string;
  uploadState: UploadState;
  attemptCount: number;
  diagnosticText: string | null;
}

export interface OperatorUiState {
  mode: 'real' | 'mock';
  simulationLabel: string | null;
  readyOffline: boolean;
  cameraReady: boolean;
  printerReady: boolean;
  networkOnline: boolean;
  diskSpaceOk: boolean;
  authExpired: boolean;
  clockHealthy: boolean;
  clockWarningReason: string | null;

  activeTenantId: string;
  activeEventId: string;
  activeStationId: string;
  activeOperatorId: string;

  availableTemplates: Array<{
    templateVersionId: string;
    name: string;
    paperLabel: string;
    requiredShots: number;
  }>;
  selectedTemplateIndex: number;

  activeSessionId: string | null;
  captureState: CaptureState;
  compositeState: CompositeState;
  printState: PrintAttemptState | null;
  printMessage: string | null;
  latestPrintAttemptId: string | null;
  uploadState: UploadState;

  isBusyCapturing: boolean;
  isBusyPrinting: boolean;
  isReprintModalOpen: boolean;
  isSyncDrawerOpen: boolean;

  shotSlots: ShotSlotPreview[];
  syncQueue: SyncQueueItemView[];
  lastActionTimestampMs: number;
  isEnrolled: boolean;
  stationPlan: string;
  dailyTransactionsCount: number;
  maxTransactionsPerDay: number | null;
  serverUrl: string;
  isEnrolling: boolean;
  enrollmentError: string | null;

  selectTemplateIndex: (index: number) => void;
  triggerCaptureOrRetake: (frameIndex?: number) => void | Promise<void>;
  approveSession: () => void | Promise<void>;
  submitPrint: (isReprint?: boolean) => void | Promise<void>;
  resolveUnknownPrint: (resolution: 'confirmed' | 'failed' | 'cancelled') => void | Promise<void>;
  startNextSession: () => void | Promise<void>;
  setReprintModalOpen: (open: boolean) => void;
  setSyncDrawerOpen: (open: boolean) => void;
  refreshSyncQueue: () => Promise<void>;
  triggerSyncNow: () => Promise<void>;
  loadInitialState: () => Promise<void>;
  enrollStation: (code: string, serverUrl?: string) => Promise<boolean>;
}

export const useOperatorStore = create<OperatorUiState>((set, get) => ({
  mode: 'mock',
  simulationLabel: 'SIMULATION / MOCK HARDWARE MODE',
  readyOffline: true,
  cameraReady: true,
  printerReady: true,
  networkOnline: true,
  diskSpaceOk: true,
  authExpired: false,
  clockHealthy: true,
  clockWarningReason: null,

  activeTenantId: '10000000-0000-4000-8000-000000000001',
  activeEventId: '20000000-0000-4000-8000-000000000001',
  activeStationId: '30000000-0000-4000-8000-000000000001',
  activeOperatorId: '40000000-0000-4000-8000-000000000001',

  availableTemplates: [
    {
      templateVersionId: '11111111-1111-4111-8111-111111111111',
      name: '4x6 Studio Postcard (4 Shots)',
      paperLabel: '4x6 Postcard',
      requiredShots: 4
    },
    {
      templateVersionId: '22222222-2222-4222-8222-222222222222',
      name: '2x6 Classic Strip (3 Shots)',
      paperLabel: '2x6 Strip',
      requiredShots: 3
    }
  ],
  selectedTemplateIndex: 0,

  activeSessionId: null,
  captureState: 'created',
  compositeState: 'pending',
  printState: null,
  printMessage: null,
  latestPrintAttemptId: null,
  uploadState: 'pending',

  isBusyCapturing: false,
  isBusyPrinting: false,
  isReprintModalOpen: false,
  isSyncDrawerOpen: false,

  shotSlots: [
    { frameIndex: 0, assetId: null, capturedAt: null, previewDataUrl: null },
    { frameIndex: 1, assetId: null, capturedAt: null, previewDataUrl: null },
    { frameIndex: 2, assetId: null, capturedAt: null, previewDataUrl: null },
    { frameIndex: 3, assetId: null, capturedAt: null, previewDataUrl: null }
  ],
  syncQueue: [],
  lastActionTimestampMs: 0,
  isEnrolled: false,
  stationPlan: 'basic',
  dailyTransactionsCount: 0,
  maxTransactionsPerDay: 50,
  serverUrl: 'http://localhost:3000',
  isEnrolling: false,
  enrollmentError: null,

  loadInitialState: async () => {
    if (typeof window !== 'undefined' && window.odcOperatorBridge) {
      try {
        const status = await window.odcOperatorBridge.getStationEnrollmentStatus();
        set({
          isEnrolled: status.enrolled,
          activeStationId: status.stationId || get().activeStationId,
          activeTenantId: status.tenantId || get().activeTenantId,
          stationPlan: status.plan || 'basic',
          dailyTransactionsCount: status.dailyTransactionsCount ?? 0,
          maxTransactionsPerDay: status.maxTransactionsPerDay ?? (status.plan === 'business' ? null : status.plan === 'plus' ? 100 : 50),
          serverUrl: status.serverUrl || get().serverUrl
        });
      } catch {
        // use default state
      }

      try {
        const state = get();
        const preflight = await window.odcOperatorBridge.getPreflightStatus(state.activeEventId);
        set({
          mode: preflight.mode,
          simulationLabel: preflight.simulationLabel,
          readyOffline: preflight.readyOffline,
          cameraReady: preflight.cameraReady,
          printerReady: preflight.printerReady,
          diskSpaceOk: preflight.diskSpaceOk,
          clockHealthy: preflight.clockHealthy,
          clockWarningReason: preflight.clockWarningReason
        });
      } catch {
        // Preflight query failed or event not yet prepared; keep defaults
      }
      await get().refreshSyncQueue();
    }
  },

  selectTemplateIndex: (index: number) => {
    const state = get();
    if (state.isBusyCapturing || state.captureState === 'capturing') {
      return;
    }
    const tpl = state.availableTemplates[index];
    if (!tpl) return;

    const slots: ShotSlotPreview[] = Array.from({ length: tpl.requiredShots }, (_, idx) => ({
      frameIndex: idx,
      assetId: null,
      capturedAt: null,
      previewDataUrl: null
    }));

    set({
      selectedTemplateIndex: index,
      shotSlots: slots,
      activeSessionId: null,
      captureState: 'created',
      compositeState: 'pending',
      printState: null,
      printMessage: null,
      latestPrintAttemptId: null
    });
  },

  triggerCaptureOrRetake: async (frameIndex?: number) => {
    const state = get();
    const nowMs = Date.now();
    // Debounce key repeats & block simultaneous captures (Section 6.3 & 14 / A18)
    if (state.isBusyCapturing || !state.diskSpaceOk || !state.cameraReady) {
      return;
    }
    if (nowMs - state.lastActionTimestampMs < 250) {
      return;
    }

    const targetIndex =
      frameIndex ??
      state.shotSlots.find((s) => s.assetId === null)?.frameIndex ??
      0;

    let sessionId = state.activeSessionId;

    // Electron IPC Bridge Integration
    if (typeof window !== 'undefined' && window.odcOperatorBridge) {
      try {
        if (!sessionId) {
          const tpl = state.availableTemplates[state.selectedTemplateIndex] ?? state.availableTemplates[0];
          if (!tpl) return;
          const startRes = await window.odcOperatorBridge.startSession({
            tenantId: state.activeTenantId,
            eventId: state.activeEventId,
            stationId: state.activeStationId,
            operatorId: state.activeOperatorId,
            templateVersionId: tpl.templateVersionId
          });
          sessionId = startRes.sessionId;
        }

        set({
          activeSessionId: sessionId,
          isBusyCapturing: true,
          captureState: 'capturing',
          lastActionTimestampMs: nowMs
        });

        const capRes = await window.odcOperatorBridge.captureFrame({
          sessionId,
          frameIndex: targetIndex
        });

        const updatedSlots = get().shotSlots.map((slot) =>
          slot.frameIndex === targetIndex
            ? {
                ...slot,
                assetId: capRes.assetId,
                capturedAt: new Date().toISOString(),
                previewDataUrl: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="100%" height="100%" fill="%2327272A"/><text x="50%" y="50%" fill="%23FAFAFA" font-family="sans-serif" font-size="20" text-anchor="middle">Shot ${targetIndex + 1}</text></svg>`
              }
            : slot
        );

        const allCaptured = updatedSlots.every((s) => s.assetId !== null);
        set({
          isBusyCapturing: false,
          shotSlots: updatedSlots,
          captureState: (capRes.captureState as CaptureState) || (allCaptured ? 'reviewing' : 'capturing')
        });
        return;
      } catch (err) {
        set({
          isBusyCapturing: false,
          captureState: get().shotSlots.some((s) => s.assetId !== null) ? 'capturing' : 'created'
        });
        console.error('IPC capture error:', err);
        return;
      }
    }

    // Graceful Browser Mock Fallback
    set({
      isBusyCapturing: true,
      captureState: 'capturing',
      lastActionTimestampMs: nowMs,
      activeSessionId: sessionId ?? `session-${nowMs}`
    });

    const updatedSlots = state.shotSlots.map((slot) =>
      slot.frameIndex === targetIndex
        ? {
            ...slot,
            assetId: `asset-${targetIndex}-${nowMs}`,
            capturedAt: new Date(nowMs).toISOString(),
            previewDataUrl: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="100%" height="100%" fill="%2327272A"/><text x="50%" y="50%" fill="%23FAFAFA" font-family="sans-serif" font-size="20" text-anchor="middle">Shot ${targetIndex + 1}</text></svg>`
          }
        : slot
    );

    const allCaptured = updatedSlots.every((s) => s.assetId !== null);
    set({
      isBusyCapturing: false,
      shotSlots: updatedSlots,
      captureState: allCaptured ? 'reviewing' : 'capturing'
    });
  },

  approveSession: async () => {
    const state = get();
    if (state.captureState !== 'reviewing' || state.isBusyCapturing) {
      return;
    }
    const sessionId = state.activeSessionId ?? `session-${Date.now()}`;

    // Electron IPC Bridge Integration
    if (typeof window !== 'undefined' && window.odcOperatorBridge && state.activeSessionId) {
      set({ captureState: 'approved', compositeState: 'rendering' });
      try {
        const res = await window.odcOperatorBridge.approveSession(state.activeSessionId);
        set({
          captureState: (res.captureState as CaptureState) || 'approved',
          compositeState: (res.compositeState as CompositeState) || 'ready',
          uploadState: (res.uploadState as UploadState) || 'uploading'
        });
        await get().refreshSyncQueue();
        return;
      } catch (err) {
        set({ compositeState: 'failed' });
        console.error('IPC approve error:', err);
        return;
      }
    }

    // Graceful Browser Mock Fallback
    set({
      captureState: 'approved',
      compositeState: 'ready',
      uploadState: 'uploading',
      syncQueue: [
        {
          sessionId,
          uploadState: 'uploading',
          attemptCount: 1,
          diagnosticText: 'Uploading approved shots and composite in background'
        },
        ...state.syncQueue.filter((item) => item.sessionId !== sessionId)
      ]
    });
  },

  submitPrint: async (isReprint = false) => {
    const state = get();
    const nowMs = Date.now();
    // Prevent duplicate unconfirmed print attempts (A05 / A18)
    if (
      state.captureState !== 'approved' ||
      state.compositeState !== 'ready' ||
      state.isBusyPrinting ||
      state.printState === 'submitting' ||
      state.printState === 'unknown'
    ) {
      return;
    }
    if (nowMs - state.lastActionTimestampMs < 350) {
      return;
    }

    // Electron IPC Bridge Integration
    if (typeof window !== 'undefined' && window.odcOperatorBridge && state.activeSessionId) {
      set({
        isBusyPrinting: true,
        isReprintModalOpen: false,
        printState: 'submitting',
        printMessage: 'Submitting print job to printer spooler...',
        lastActionTimestampMs: nowMs
      });

      try {
        const res = await window.odcOperatorBridge.submitPrint({
          sessionId: state.activeSessionId,
          printProfileId: 'prof-4x6-standard',
          copies: 1,
          isReprint: Boolean(isReprint)
        });
        set({
          isBusyPrinting: false,
          printState: res.state as PrintAttemptState,
          printMessage: res.displayMessage,
          latestPrintAttemptId: res.attemptId
        });
        return;
      } catch (err) {
        set({
          isBusyPrinting: false,
          printState: 'failed',
          printMessage: err instanceof Error ? err.message : 'Print submission failed'
        });
        return;
      }
    }

    // Graceful Browser Mock Fallback
    set({
      isBusyPrinting: false,
      isReprintModalOpen: false,
      printState: 'submitted',
      printMessage: isReprint
        ? 'Reprint submitted — check printer'
        : 'Submitted — check printer',
      lastActionTimestampMs: nowMs
    });
  },

  resolveUnknownPrint: async (resolution) => {
    const state = get();
    if (state.printState !== 'unknown') return;

    // Electron IPC Bridge Integration
    if (typeof window !== 'undefined' && window.odcOperatorBridge && state.latestPrintAttemptId) {
      try {
        const res = await window.odcOperatorBridge.resolveUnknownPrint({
          attemptId: state.latestPrintAttemptId,
          resolution,
          operatorNote: 'Resolved by operator in capture console'
        });
        set({
          printState: res.state as PrintAttemptState,
          printMessage: `Operator resolved unknown outcome as: ${resolution}`
        });
        return;
      } catch (err) {
        console.error('IPC resolve unknown error:', err);
      }
    }

    // Graceful Browser Mock Fallback
    set({
      printState: resolution,
      printMessage: `Operator resolved unknown outcome as: ${resolution}`
    });
  },

  /**
   * Before the next session, reset visible customer photos while retaining
   * required background sync work in the drawer (Section 14).
   */
  startNextSession: () => {
    const state = get();
    const tpl = state.availableTemplates[state.selectedTemplateIndex];
    const requiredShots = tpl?.requiredShots ?? 4;
    set({
      activeSessionId: null,
      captureState: 'created',
      compositeState: 'pending',
      printState: null,
      printMessage: null,
      latestPrintAttemptId: null,
      uploadState: 'pending',
      isReprintModalOpen: false,
      shotSlots: Array.from({ length: requiredShots }, (_, idx) => ({
        frameIndex: idx,
        assetId: null,
        capturedAt: null,
        previewDataUrl: null
      }))
    });
  },

  refreshSyncQueue: async () => {
    if (typeof window !== 'undefined' && window.odcOperatorBridge) {
      try {
        const status = await window.odcOperatorBridge.getSyncStatus();
        const views: SyncQueueItemView[] = status.queue.map((item) => ({
          sessionId: item.sessionId,
          uploadState: item.uploadState,
          attemptCount: item.attemptCount,
          diagnosticText: item.diagnosticText
        }));
        set({ syncQueue: views });
      } catch {
        // queue refresh error
      }
    }
  },

  triggerSyncNow: async () => {
    if (typeof window !== 'undefined' && window.odcOperatorBridge) {
      try {
        await window.odcOperatorBridge.triggerSyncCycle();
        await get().refreshSyncQueue();
      } catch {
        // sync error
      }
    }
  },

  setReprintModalOpen: (open: boolean) => set({ isReprintModalOpen: open }),
  setSyncDrawerOpen: (open: boolean) => set({ isSyncDrawerOpen: open }),

  enrollStation: async (code: string, serverUrl?: string): Promise<boolean> => {
    const targetUrl = serverUrl || get().serverUrl || 'http://localhost:3000';
    set({ isEnrolling: true, enrollmentError: null });

    if (typeof window !== 'undefined' && window.odcOperatorBridge) {
      try {
        const result = await window.odcOperatorBridge.enrollStation({
          serverUrl: targetUrl,
          code: code.trim().toUpperCase(),
          deviceLabel: 'Operator Desktop Station'
        });

        set({
          isEnrolled: true,
          isEnrolling: false,
          enrollmentError: null,
          activeStationId: result.stationId,
          activeTenantId: result.tenantId,
          stationPlan: result.plan,
          serverUrl: targetUrl,
          maxTransactionsPerDay: result.plan === 'business' ? null : result.plan === 'plus' ? 100 : 50
        });

        await get().loadInitialState();
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Enrollment failed';
        set({
          isEnrolling: false,
          enrollmentError: message
        });
        return false;
      }
    } else {
      // Mock enrollment for non-electron test environment
      set({
        isEnrolled: true,
        isEnrolling: false,
        enrollmentError: null,
        stationPlan: 'plus',
        maxTransactionsPerDay: 100
      });
      return true;
    }
  }
}));
