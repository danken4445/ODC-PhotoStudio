import path from 'node:path';
import { app, BrowserWindow, ipcMain, session as electronSession } from 'electron';
import { z } from 'zod';
import {
  CreateSessionIpcRequestSchema,
  ResolveUnknownPrintIpcRequestSchema,
  SubmitPrintIpcRequestSchema,
  TriggerCaptureIpcRequestSchema
} from '@odc-photostudio/contracts';
import type { StationOrchestrator } from './orchestrator.js';

export const SECURITY_WINDOW_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false
} as const;

export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'";

export function registerValidatedIpcHandlers(orchestrator: StationOrchestrator): void {
  ipcMain.handle('odc:preflight:status', (_event, rawPayload: unknown) => {
    const { eventId } = z.object({ eventId: z.string().uuid() }).parse(rawPayload);
    return orchestrator.evaluatePreflight(eventId);
  });

  ipcMain.handle('odc:session:start', (_event, rawPayload: unknown) => {
    const req = CreateSessionIpcRequestSchema.parse(rawPayload);
    const { session } = orchestrator.startSession({
      eventId: req.eventId,
      templateVersionId: req.templateVersionId
    });
    return { sessionId: session.session_id };
  });

  ipcMain.handle('odc:session:capture', async (_event, rawPayload: unknown) => {
    const req = TriggerCaptureIpcRequestSchema.parse(rawPayload);
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

  ipcMain.handle('odc:session:approve', async (_event, rawPayload: unknown) => {
    const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(rawPayload);
    const { session } = await orchestrator.approveAndCompositeSession({ sessionId });
    return {
      sessionId: session.session_id,
      captureState: session.capture_state,
      compositeState: session.composite_state,
      uploadState: session.upload_state
    };
  });

  ipcMain.handle('odc:print:submit', async (_event, rawPayload: unknown) => {
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

  ipcMain.handle('odc:print:resolve-unknown', (_event, rawPayload: unknown) => {
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
}

export function createOperatorWindow(preloadPath: string, rendererUrl: string): BrowserWindow {
  electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY]
      }
    });
  });

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
    if (!navigationUrl.startsWith(rendererUrl)) {
      event.preventDefault();
    }
  });

  void win.loadURL(rendererUrl);
  return win;
}

if (app && typeof app.whenReady === 'function') {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  }
}
export { path };
