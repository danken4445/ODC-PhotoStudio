import { contextBridge, ipcRenderer } from 'electron';
import type {
  CreateSessionIpcRequest,
  ResolveUnknownPrintIpcRequest,
  StationPreflightStatus,
  SubmitPrintIpcRequest,
  TriggerCaptureIpcRequest,
  UploadState
} from '@odc-photostudio/contracts';

export interface SyncStatusItem {
  jobId: string;
  sessionId: string;
  uploadState: UploadState;
  state?: UploadState;
  attemptCount: number;
  diagnosticText: string | null;
  errorCode: string | null;
  nextAttemptAt: string;
  updatedAt: string;
}

export interface SyncStatusView {
  queue: SyncStatusItem[];
  pendingCount: number;
  publishedCount: number;
  failedCount: number;
  blockedAuthCount: number;
}

/**
 * Narrowly scoped typed Preload API exposed via contextBridge (Section 5 & 15):
 * - No direct Node.js buffers, fs paths, or database handles exposed to renderer
 * - All payloads runtime-validated in main process IPC handlers
 */
export interface OperatorDesktopBridge {
  getPreflightStatus(eventId: string): Promise<StationPreflightStatus>;
  startSession(req: CreateSessionIpcRequest): Promise<{ sessionId: string }>;
  captureFrame(req: TriggerCaptureIpcRequest): Promise<{
    assetId: string;
    frameIndex: number;
    captureState: string;
  }>;
  approveSession(sessionId: string): Promise<{
    sessionId: string;
    captureState: string;
    compositeState: string;
    uploadState: string;
  }>;
  submitPrint(req: SubmitPrintIpcRequest): Promise<{
    attemptId: string;
    state: string;
    displayMessage: string;
  }>;
  resolveUnknownPrint(req: ResolveUnknownPrintIpcRequest): Promise<{
    attemptId: string;
    state: string;
  }>;
  getSyncStatus(): Promise<SyncStatusView>;
  triggerSyncCycle(): Promise<{ processed: boolean; sessionId?: string; finalState?: string }>;
  enrollStation: (params: { serverUrl: string; code: string; deviceLabel?: string }) => Promise<{
    tenantId: string;
    stationId: string;
    status: string;
    plan: string;
  }>;
  getStationEnrollmentStatus: () => Promise<{
    enrolled: boolean;
    stationId?: string;
    tenantId?: string;
    plan?: string;
    serverUrl?: string;
    dailyTransactionsCount?: number;
    maxTransactionsPerDay?: number | null;
  }>;
}

const api: OperatorDesktopBridge = {
  getPreflightStatus: (eventId: string) =>
    ipcRenderer.invoke('odc:preflight:status', { eventId }),
  startSession: (req: CreateSessionIpcRequest) =>
    ipcRenderer.invoke('odc:session:start', req),
  captureFrame: (req: TriggerCaptureIpcRequest) =>
    ipcRenderer.invoke('odc:session:capture', req),
  approveSession: (sessionId: string) =>
    ipcRenderer.invoke('odc:session:approve', { sessionId }),
  submitPrint: (req: SubmitPrintIpcRequest) =>
    ipcRenderer.invoke('odc:print:submit', req),
  resolveUnknownPrint: (req: ResolveUnknownPrintIpcRequest) =>
    ipcRenderer.invoke('odc:print:resolve-unknown', req),
  getSyncStatus: () =>
    ipcRenderer.invoke('odc:sync:status'),
  triggerSyncCycle: () =>
    ipcRenderer.invoke('odc:sync:trigger'),
  enrollStation: (params: { serverUrl: string; code: string; deviceLabel?: string }) =>
    ipcRenderer.invoke('odc:station:enroll', params),
  getStationEnrollmentStatus: () =>
    ipcRenderer.invoke('odc:station:enrollment-status')
};

if (typeof contextBridge !== 'undefined' && contextBridge.exposeInMainWorld) {
  contextBridge.exposeInMainWorld('odcOperatorBridge', api);
}

declare global {
  interface Window {
    odcOperatorBridge?: OperatorDesktopBridge;
  }
}
