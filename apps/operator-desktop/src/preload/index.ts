import { contextBridge, ipcRenderer } from 'electron';
import type {
  CreateSessionIpcRequest,
  ResolveUnknownPrintIpcRequest,
  StationPreflightStatus,
  SubmitPrintIpcRequest,
  TriggerCaptureIpcRequest
} from '@odc-photostudio/contracts';

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
    ipcRenderer.invoke('odc:print:resolve-unknown', req)
};

contextBridge.exposeInMainWorld('odcOperatorBridge', api);
