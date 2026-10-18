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
  uploadState: UploadState;

  isBusyCapturing: boolean;
  isBusyPrinting: boolean;
  isReprintModalOpen: boolean;
  isSyncDrawerOpen: boolean;

  shotSlots: ShotSlotPreview[];
  syncQueue: SyncQueueItemView[];
  lastActionTimestampMs: number;

  selectTemplateIndex: (index: number) => void;
  triggerCaptureOrRetake: (frameIndex?: number) => void;
  approveSession: () => void;
  submitPrint: (isReprint?: boolean) => void;
  resolveUnknownPrint: (resolution: 'confirmed' | 'failed' | 'cancelled') => void;
  startNextSession: () => void;
  setReprintModalOpen: (open: boolean) => void;
  setSyncDrawerOpen: (open: boolean) => void;
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

  activeSessionId: '00000000-0000-4000-8000-000000000101',
  captureState: 'created',
  compositeState: 'pending',
  printState: null,
  printMessage: null,
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
      captureState: 'created',
      compositeState: 'pending',
      printState: null,
      printMessage: null
    });
  },

  triggerCaptureOrRetake: (frameIndex?: number) => {
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

    set({
      isBusyCapturing: true,
      captureState: 'capturing',
      lastActionTimestampMs: nowMs
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

  approveSession: () => {
    const state = get();
    if (state.captureState !== 'reviewing' || state.isBusyCapturing) {
      return;
    }
    const sessionId = state.activeSessionId ?? `session-${Date.now()}`;
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

  submitPrint: (isReprint = false) => {
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

  resolveUnknownPrint: (resolution) => {
    const state = get();
    if (state.printState !== 'unknown') return;
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
      activeSessionId: `00000000-0000-4000-8000-${String(Date.now()).slice(-12)}`,
      captureState: 'created',
      compositeState: 'pending',
      printState: null,
      printMessage: null,
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

  setReprintModalOpen: (open: boolean) => set({ isReprintModalOpen: open }),
  setSyncDrawerOpen: (open: boolean) => set({ isSyncDrawerOpen: open })
}));
