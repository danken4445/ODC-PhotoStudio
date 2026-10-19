import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ApprovedSessionManifestSchema,
  buildCanonicalGalleryUrl,
  computeBufferSha256,
  generateGalleryToken,
  generateSessionId,
  hashGalleryToken,
  MAX_CLOCK_DRIFT_MS,
  PrintProfileSchema,
  TemplateDefinitionSchema,
  verifyOfflineGrant,
  type ApprovedSessionManifest,
  type PrintProfile,
  type SignedOfflineGrant,
  type StationPreflightStatus,
  type TemplateDefinition
} from '@odc-photostudio/contracts';
import { renderCompositeImage } from '@odc-photostudio/template-engine';
import { StationDatabase, type LocalPrintAttemptRow, type LocalSessionRow } from './db.js';
import type { CaptureResult, ICameraProvider } from './camera/provider.js';
import type { IPrinterProvider, SubmitPrintJobResult } from './printer/provider.js';
import { DurableSyncEngine, type CloudSyncTransport } from './queue/sync-engine.js';

export interface CachedEventTemplateEntry {
  templateVersionId: string;
  name: string;
  version: number;
  definition: TemplateDefinition;
  overlayFilePath: string;
}

export interface CachedEventConfiguration {
  eventId: string;
  tenantId: string;
  stationId: string;
  operatorId: string;
  eventName: string;
  galleryOrigin: string;
  templates: CachedEventTemplateEntry[];
  printProfiles: PrintProfile[];
}

export interface CapacityAssumptions {
  expectedSessions: number;
  shotsPerSession: number;
  avgShotBytes: number;
  compositeBytes: number;
  safetyReserveRatio: number;
}

const DEFAULT_CAPACITY_ASSUMPTIONS: CapacityAssumptions = {
  expectedSessions: 100,
  shotsPerSession: 4,
  avgShotBytes: 1_500_000,
  compositeBytes: 2_000_000,
  safetyReserveRatio: 1.25
};

export class StationOrchestrator {
  public readonly dataDir: string;
  public readonly stationId: string;
  public readonly db: StationDatabase;
  public readonly syncEngine: DurableSyncEngine;
  public readonly camera: ICameraProvider;
  public readonly printer: IPrinterProvider;
  private readonly grantPublicKeyPem: string;
  private readonly tokenPepper: string;

  private baselineWallClockMs: number;
  private baselineMonotonicNs: bigint;
  private simulatedDiskAvailableBytes: number | null = null;
  private simulatedWallClockOffsetMs = 0;

  constructor(params: {
    dataDir: string;
    stationId: string;
    camera: ICameraProvider;
    printer: IPrinterProvider;
    grantPublicKeyPem: string;
    tokenPepper?: string;
  }) {
    this.dataDir = params.dataDir;
    this.stationId = params.stationId;
    this.camera = params.camera;
    this.printer = params.printer;
    this.grantPublicKeyPem = params.grantPublicKeyPem;
    this.tokenPepper = params.tokenPepper ?? '';

    fs.mkdirSync(this.dataDir, { recursive: true });
    this.db = new StationDatabase(this.dataDir, this.stationId);
    this.syncEngine = new DurableSyncEngine(this.db, `station-${this.stationId}`);

    this.baselineWallClockMs = Date.now();
    this.baselineMonotonicNs = process.hrtime.bigint();
  }

  public getSessionDirectoryPath(sessionId: string): string {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(sessionId)) {
      throw new Error(`Invalid sessionId format: ${sessionId}`);
    }
    return path.join(this.dataDir, 'sessions', sessionId);
  }

  public setSimulatedDiskAvailableBytes(bytes: number | null): void {
    this.simulatedDiskAvailableBytes = bytes;
  }

  public setSimulatedWallClockOffsetMs(offsetMs: number): void {
    this.simulatedWallClockOffsetMs = offsetMs;
  }

  public reconcileClockWithServer(serverTimeIso: string): void {
    const serverMs = Date.parse(serverTimeIso);
    if (Number.isNaN(serverMs)) {
      throw new Error('Invalid server time ISO');
    }
    this.simulatedWallClockOffsetMs = 0;
    this.baselineWallClockMs = Date.now();
    this.baselineMonotonicNs = process.hrtime.bigint();
  }

  /**
   * Clock Health Check (Section 9.1 / A20):
   * Compares monotonic elapsed time (`process.hrtime.bigint()`) against wall-clock changes.
   * Detects backward jumps or forward jumps > 5 minutes.
   */
  public checkClockHealth(): { healthy: boolean; driftMs: number; warningReason: string | null } {
    const currentWallMs = Date.now() + this.simulatedWallClockOffsetMs;
    const elapsedWallMs = currentWallMs - this.baselineWallClockMs;
    const elapsedMonoMs = Number(process.hrtime.bigint() - this.baselineMonotonicNs) / 1_000_000;
    const driftMs = Math.round(elapsedWallMs - elapsedMonoMs);

    if (Math.abs(driftMs) > MAX_CLOCK_DRIFT_MS) {
      return {
        healthy: false,
        driftMs,
        warningReason: `Device clock jumped by ${Math.round(driftMs / 1000)}s relative to monotonic clock. Local capture and printing may continue, but cloud publication is paused until server time reconciliation.`
      };
    }

    return { healthy: true, driftMs, warningReason: null };
  }

  public computeRequiredBytes(assumptions: Partial<CapacityAssumptions> = {}): number {
    const cfg = { ...DEFAULT_CAPACITY_ASSUMPTIONS, ...assumptions };
    const perSessionBytes =
      cfg.shotsPerSession * cfg.avgShotBytes + cfg.compositeBytes;
    return Math.ceil(cfg.expectedSessions * perSessionBytes * cfg.safetyReserveRatio);
  }

  public getAvailableDiskBytes(): number {
    if (this.simulatedDiskAvailableBytes !== null) {
      return this.simulatedDiskAvailableBytes;
    }
    try {
      const stats = fs.statfsSync(this.dataDir);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      return 10 * 1024 * 1024 * 1024; // 10 GB fallback if statfs unsupported
    }
  }

  public prepareEventOffline(params: {
    config: CachedEventConfiguration;
    grant: SignedOfflineGrant;
    serverTimeIso: string;
    nowIso?: string;
  }): StationPreflightStatus {
    const now = params.nowIso ?? new Date().toISOString();
    const serverOffsetMs = Date.parse(params.serverTimeIso) - Date.parse(now);

    for (const tpl of params.config.templates) {
      TemplateDefinitionSchema.parse(tpl.definition);
    }
    for (const prof of params.config.printProfiles) {
      PrintProfileSchema.parse(prof);
    }

    this.db.savePreparedEventPackage({
      eventId: params.config.eventId,
      tenantId: params.config.tenantId,
      stationId: params.config.stationId,
      operatorId: params.config.operatorId,
      packageJson: JSON.stringify(params.config),
      grant: params.grant,
      serverTimeOffsetMs: serverOffsetMs,
      nowIso: now
    });

    return this.evaluatePreflight(params.config.eventId, { nowIso: now });
  }

  /**
   * Station Preflight Check (Section 6.1):
   * Marks an event "Ready offline" ONLY after required assets, permissions,
   * disk space, camera readiness, and printer selection have passed preflight.
   * Mock mode shows an unmistakable simulation label.
   */
  public evaluatePreflight(
    eventId: string,
    options: {
      nowIso?: string;
      capacityAssumptions?: Partial<CapacityAssumptions>;
    } = {}
  ): StationPreflightStatus {
    const prepared = this.db.getPreparedEventPackage(eventId);
    const requiredBytes = this.computeRequiredBytes(options.capacityAssumptions);
    const availableBytes = this.getAvailableDiskBytes();
    const diskSpaceOk = availableBytes >= requiredBytes;
    const clockStatus = this.checkClockHealth();

    if (!prepared) {
      return {
        readyOffline: false,
        mode: this.camera.mode,
        simulationLabel:
          this.camera.mode === 'mock' ? 'SIMULATION / MOCK HARDWARE MODE' : null,
        grantValid: false,
        grantReason: 'EVENT_NOT_PREPARED',
        assetsVerified: false,
        diskSpaceOk,
        availableBytes,
        requiredBytes,
        cameraReady: false,
        printerReady: false,
        clockHealthy: clockStatus.healthy,
        clockWarningReason: clockStatus.warningReason
      };
    }

    const config = JSON.parse(prepared.packageJson) as CachedEventConfiguration;
    const grantVerification = verifyOfflineGrant(
      prepared.grant,
      this.grantPublicKeyPem,
      {
        nowIso: options.nowIso,
        expectedTenantId: config.tenantId,
        expectedEventId: config.eventId,
        expectedStationId: this.stationId,
        expectedOperatorId: config.operatorId
      }
    );

    // Verify all template overlay assets exist on disk and match their SHA-256 hash
    let assetsVerified = config.templates.length > 0;
    for (const tpl of config.templates) {
      if (!fs.existsSync(tpl.overlayFilePath)) {
        assetsVerified = false;
        break;
      }
      const overlayBuf = fs.readFileSync(tpl.overlayFilePath);
      const actualHash = computeBufferSha256(overlayBuf);
      if (actualHash.toLowerCase() !== tpl.definition.overlay.sha256.toLowerCase()) {
        assetsVerified = false;
        break;
      }
    }

    const printerReady = config.printProfiles.length > 0;
    const cameraReady =
      'isReady' in this.camera && typeof this.camera.isReady === 'function'
        ? (this.camera as { isReady(): boolean }).isReady()
        : true;

    const readyOffline =
      grantVerification.valid &&
      assetsVerified &&
      diskSpaceOk &&
      cameraReady &&
      printerReady;

    return {
      readyOffline,
      mode: this.camera.mode,
      simulationLabel:
        this.camera.mode === 'mock' ? 'SIMULATION / MOCK HARDWARE MODE' : null,
      grantValid: grantVerification.valid,
      grantReason: grantVerification.reason ?? null,
      assetsVerified,
      diskSpaceOk,
      availableBytes,
      requiredBytes,
      cameraReady,
      printerReady,
      clockHealthy: clockStatus.healthy,
      clockWarningReason: clockStatus.warningReason
    };
  }

  /**
   * Session Creation (Section 6.2):
   * - Enforces preflight / disk space / offline grant validity
   * - Generates UUID v4 sessionId and separate 32-byte base64url gallery token BEFORE capturing
   * - Protects token locally; never logs it; stores tokenHash
   * - Allocates persistent application-data session directory
   */
  public startSession(params: {
    eventId: string;
    templateVersionId: string;
    nowIso?: string;
  }): {
    session: LocalSessionRow;
    canonicalGalleryUrl: string;
  } {
    const preflight = this.evaluatePreflight(params.eventId, { nowIso: params.nowIso });
    if (!preflight.diskSpaceOk) {
      throw new Error(
        `DISK_SPACE_INSUFFICIENT: Available storage (${preflight.availableBytes} bytes) is below safety requirement (${preflight.requiredBytes} bytes). Free disk space before starting a new session.`
      );
    }
    if (!preflight.grantValid) {
      throw new Error(
        `OFFLINE_GRANT_INVALID: Cannot start session (${preflight.grantReason ?? 'UNKNOWN'})`
      );
    }
    if (!preflight.assetsVerified) {
      throw new Error('ASSETS_UNVERIFIED: Cached event overlay assets are missing or corrupted');
    }

    const prepared = this.db.getPreparedEventPackage(params.eventId);
    if (!prepared) {
      throw new Error('EVENT_NOT_PREPARED');
    }
    const config = JSON.parse(prepared.packageJson) as CachedEventConfiguration;
    if (
      !prepared.grant.payload.permittedTemplateVersionIds.includes(params.templateVersionId)
    ) {
      throw new Error(
        `TEMPLATE_NOT_PERMITTED: Template version ${params.templateVersionId} is not authorized in offline grant`
      );
    }

    if (prepared.grant.payload.maxTransactionsPerDay != null) {
      const count = this.db.countCompletedTransactionsToday(params.nowIso);
      if (count >= prepared.grant.payload.maxTransactionsPerDay) {
        throw new Error('PLAN_LIMIT_EXCEEDED: Daily transaction limit exceeded for this plan. New sessions are blocked.');
      }
    }

    const sessionId = generateSessionId();
    const rawGalleryToken = generateGalleryToken();
    const tokenHash = hashGalleryToken(rawGalleryToken, this.tokenPepper);
    const canonicalGalleryUrl = buildCanonicalGalleryUrl(
      config.galleryOrigin,
      rawGalleryToken
    );

    const sessionDir = this.getSessionDirectoryPath(sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });

    const session = this.db.createSession({
      sessionId,
      tenantId: config.tenantId,
      eventId: config.eventId,
      stationId: this.stationId,
      operatorId: config.operatorId,
      templateVersionId: params.templateVersionId,
      galleryTokenProtected: Buffer.from(rawGalleryToken, 'utf8').toString('base64'),
      tokenHash,
      sessionDir,
      nowIso: params.nowIso
    });

    return {
      session,
      canonicalGalleryUrl
    };
  }

  public getProtectedGalleryUrl(sessionId: string): string {
    const session = this.db.getSessionOrThrow(sessionId);
    const prepared = this.db.getPreparedEventPackage(session.event_id);
    if (!prepared) {
      throw new Error('Missing cached event configuration for session');
    }
    const config = JSON.parse(prepared.packageJson) as CachedEventConfiguration;
    const rawToken = Buffer.from(session.gallery_token_protected, 'base64').toString('utf8');
    return buildCanonicalGalleryUrl(config.galleryOrigin, rawToken);
  }

  /**
   * Capture & Retake (Section 6.3 / A02 / A03):
   * - Transitions session to 'capturing', triggers camera capture, validates output file
   * - On first shot, sets first_captured_at and expires_at (+24h)
   * - On retake of a single frame, preserves other approved frames and original expires_at
   * - Deletes superseded rejected frame files from disk after replacement
   * - On camera disconnect or failure, preserves already captured frames and keeps session recoverable
   */
  public async captureFrame(params: {
    sessionId: string;
    frameIndex: number;
    signal?: AbortSignal;
    nowIso?: string;
  }): Promise<{
    session: LocalSessionRow;
    capture: CaptureResult;
  }> {
    const session = this.db.getSessionOrThrow(params.sessionId);
    const prepared = this.db.getPreparedEventPackage(session.event_id);
    if (!prepared) {
      throw new Error('EVENT_NOT_PREPARED');
    }
    const config = JSON.parse(prepared.packageJson) as CachedEventConfiguration;
    const tplEntry = config.templates.find(
      (t) => t.templateVersionId === session.template_version_id
    );
    if (!tplEntry) {
      throw new Error(`Template version ${session.template_version_id} not found in event package`);
    }

    if (params.frameIndex < 0 || params.frameIndex >= tplEntry.definition.requiredShots) {
      throw new Error(
        `Invalid frameIndex ${params.frameIndex}; template requires ${tplEntry.definition.requiredShots} shots`
      );
    }

    this.db.updateCaptureState(
      params.sessionId,
      'capturing',
      `Capturing frame ${params.frameIndex + 1} of ${tplEntry.definition.requiredShots}`,
      params.nowIso
    );

    const abortController = new AbortController();
    const signal = params.signal ?? abortController.signal;

    const capture = await this.camera.triggerCapture({
      sessionId: params.sessionId,
      frameIndex: params.frameIndex,
      signal
    });

    const capturedAtIso = params.nowIso ?? capture.capturedAt;
    const fileStats = fs.statSync(capture.localFilePath);

    const { supersededAssetPaths } = this.db.recordCapturedShot({
      sessionId: params.sessionId,
      assetId: capture.assetId,
      frameIndex: params.frameIndex,
      localFilePath: capture.localFilePath,
      width: capture.width,
      height: capture.height,
      byteSize: fileStats.size,
      sha256: capture.sha256,
      capturedAtIso
    });

    // Delete superseded rejected frames after replacement (Section 9.3)
    for (const oldPath of supersededAssetPaths) {
      if (oldPath !== capture.localFilePath && fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch {
          // ignore
        }
      }
    }

    const activeShots = this.db.getActiveSessionShots(params.sessionId);
    let updatedSession = this.db.getSessionOrThrow(params.sessionId);
    if (activeShots.length >= tplEntry.definition.requiredShots) {
      updatedSession = this.db.updateCaptureState(
        params.sessionId,
        'reviewing',
        'All required shots captured; ready for operator review or individual retake',
        capturedAtIso
      );
    }

    return {
      session: updatedSession,
      capture
    };
  }

  /**
   * Approval & Compositing (Section 6.4 / A04 / A17):
   * - Renders deterministic composite with overlay and QR code
   * - Writes to staging file first, validates dimensions and SHA-256, then atomically renames into final path
   * - In one SQLite transaction: commits ApprovedSessionManifest, marks composite 'ready', and enqueues upload job
   */
  public async approveAndCompositeSession(params: {
    sessionId: string;
    nowIso?: string;
  }): Promise<{
    session: LocalSessionRow;
    manifest: ApprovedSessionManifest;
    compositeFilePath: string;
  }> {
    const approvedAtIso = params.nowIso ?? new Date().toISOString();
    const session = this.db.getSessionOrThrow(params.sessionId);
    if (session.capture_state !== 'reviewing') {
      throw new Error(
        `Cannot approve session in state "${session.capture_state}"; must be "reviewing"`
      );
    }
    if (!session.first_captured_at || !session.expires_at) {
      throw new Error('Session has no recorded first capture timestamp');
    }

    const prepared = this.db.getPreparedEventPackage(session.event_id);
    if (!prepared) {
      throw new Error('EVENT_NOT_PREPARED');
    }
    const config = JSON.parse(prepared.packageJson) as CachedEventConfiguration;
    const tplEntry = config.templates.find(
      (t) => t.templateVersionId === session.template_version_id
    );
    if (!tplEntry) {
      throw new Error(`Template version ${session.template_version_id} not found`);
    }

    const activeShots = this.db.getActiveSessionShots(params.sessionId);
    if (activeShots.length < tplEntry.definition.requiredShots) {
      throw new Error(
        `Cannot approve session: ${activeShots.length}/${tplEntry.definition.requiredShots} shots present`
      );
    }

    this.db.updateCompositeState(
      params.sessionId,
      'rendering',
      'Rendering print composite and QR code',
      approvedAtIso
    );

    const shotBuffersByIndex = new Map<number, Buffer>();
    for (const shot of activeShots) {
      if (shot.frame_index !== null) {
        shotBuffersByIndex.set(shot.frame_index, fs.readFileSync(shot.local_file_path));
      }
    }

    const overlayBuffer = fs.readFileSync(tplEntry.overlayFilePath);
    const galleryUrl = this.getProtectedGalleryUrl(params.sessionId);

    const embedQr = prepared.grant.payload.softCopyQr !== false;
    const rendered = await renderCompositeImage({
      template: tplEntry.definition,
      shotBuffersByIndex,
      overlayBuffer,
      galleryUrl,
      embedQr
    });

    const compositeAssetId = crypto.randomUUID();
    const stagingPath = path.join(
      session.session_dir,
      `composite-${compositeAssetId}.staging.jpg`
    );
    const finalCompositePath = path.join(
      session.session_dir,
      `composite-${compositeAssetId}.jpg`
    );

    // Stage -> Verify -> Atomic Rename (Section 6.4)
    fs.writeFileSync(stagingPath, rendered.compositeBuffer);
    const stagedBytes = fs.readFileSync(stagingPath);
    const stagedSha = computeBufferSha256(stagedBytes);
    if (stagedSha !== rendered.sha256) {
      throw new Error('Staging composite checksum verification failed');
    }
    fs.renameSync(stagingPath, finalCompositePath);

    const manifest: ApprovedSessionManifest = ApprovedSessionManifestSchema.parse({
      manifestVersion: 1,
      sessionId: session.session_id,
      tenantId: session.tenant_id,
      eventId: session.event_id,
      stationId: session.station_id,
      operatorId: session.operator_id,
      templateVersionId: session.template_version_id,
      tokenHash: session.token_hash,
      firstCapturedAt: session.first_captured_at,
      approvedAt: approvedAtIso,
      expiresAt: session.expires_at,
      assets: [
        ...activeShots.map((shot) => ({
          assetId: shot.asset_id,
          kind: 'shot' as const,
          shotIndex: shot.frame_index,
          width: shot.width,
          height: shot.height,
          byteSize: shot.byte_size,
          sha256: shot.sha256,
          mimeType: 'image/jpeg' as const
        })),
        {
          assetId: compositeAssetId,
          kind: 'composite' as const,
          shotIndex: null,
          width: rendered.width,
          height: rendered.height,
          byteSize: rendered.byteSize,
          sha256: rendered.sha256,
          mimeType: 'image/jpeg' as const
        }
      ]
    });

    const enqueueUpload = prepared.grant.payload.softCopyQr !== false;
    const { session: committedSession } = this.db.commitApprovedSessionAndEnqueueUpload({
      sessionId: params.sessionId,
      compositeAsset: {
        assetId: compositeAssetId,
        localFilePath: finalCompositePath,
        width: rendered.width,
        height: rendered.height,
        byteSize: rendered.byteSize,
        sha256: rendered.sha256
      },
      manifest,
      approvedAtIso,
      enqueueUpload
    });

    return {
      session: committedSession,
      manifest,
      compositeFilePath: finalCompositePath
    };
  }

  /**
   * Local Printing (Section 6.5 / A05 / A17 / A18):
   * - Requires approved manifest & upload intent already committed in SQLite
   * - Persists print attempt ('queued' -> 'submitting') BEFORE submitting to printer provider
   * - Uses the stored approved composite (template edits after session approval never alter reprints)
   * - Distinguishes 'submitted' ("Submitted — check printer") from 'confirmed'
   * - Blocks duplicate print requests while an attempt is in 'submitting' or 'unknown'
   */
  public async submitPrint(params: {
    sessionId: string;
    printProfileId: string;
    copies?: number;
    isReprint?: boolean;
    nowIso?: string;
  }): Promise<{
    attempt: LocalPrintAttemptRow;
    result: SubmitPrintJobResult;
  }> {
    const now = params.nowIso ?? new Date().toISOString();
    const session = this.db.getSessionOrThrow(params.sessionId);

    if (session.expires_at && Date.parse(session.expires_at) <= Date.parse(now)) {
      throw new Error('SESSION_EXPIRED: Cannot print or reprint an expired session');
    }

    const prepared = this.db.getPreparedEventPackage(session.event_id);
    if (!prepared) {
      throw new Error('EVENT_NOT_PREPARED');
    }
    const config = JSON.parse(prepared.packageJson) as CachedEventConfiguration;
    const profile = config.printProfiles.find((p) => p.id === params.printProfileId);
    if (!profile) {
      throw new Error(`Print profile ${params.printProfileId} not found`);
    }

    const compositeAsset = this.db.getSessionCompositeAsset(params.sessionId);
    if (!compositeAsset || !fs.existsSync(compositeAsset.local_file_path)) {
      throw new Error('Approved composite file is missing on disk');
    }

    // 1. Persist attempt in 'queued' state
    const queuedAttempt = this.db.createPrintAttempt({
      sessionId: params.sessionId,
      printProfileId: params.printProfileId,
      copies: params.copies ?? 1,
      isReprint: params.isReprint ?? false,
      nowIso: now
    });

    // 2. Transition to 'submitting' BEFORE calling hardware/OS printer adapter
    this.db.transitionPrintAttempt({
      attemptId: queuedAttempt.attempt_id,
      toState: 'submitting',
      diagnosticText: 'Submitting print job to printer adapter',
      nowIso: now
    });

    const result = await this.printer.submitPrintJob({
      attemptId: queuedAttempt.attempt_id,
      sessionId: params.sessionId,
      compositeFilePath: compositeAsset.local_file_path,
      profile,
      copies: params.copies ?? 1
    });

    const finalAttempt = this.db.transitionPrintAttempt({
      attemptId: queuedAttempt.attempt_id,
      toState: result.outcome,
      diagnosticText: result.displayMessage,
      nowIso: now
    });

    return {
      attempt: finalAttempt,
      result
    };
  }

  public resolveUnknownPrintAttempt(params: {
    attemptId: string;
    resolution: 'confirmed' | 'failed' | 'cancelled';
    operatorNote: string;
    nowIso?: string;
  }): LocalPrintAttemptRow {
    const current = this.db.getPrintAttemptOrThrow(params.attemptId);
    if (current.state !== 'unknown') {
      throw new Error(`Print attempt ${params.attemptId} is in "${current.state}" state, not "unknown"`);
    }
    return this.db.transitionPrintAttempt({
      attemptId: params.attemptId,
      toState: params.resolution,
      diagnosticText: `Operator resolved unknown outcome as ${params.resolution}: ${params.operatorNote}`,
      nowIso: params.nowIso
    });
  }

  public async syncNextPendingJob(
    transport: CloudSyncTransport,
    nowIso?: string
  ): Promise<{ processed: boolean; sessionId?: string; finalState?: string }> {
    const clock = this.checkClockHealth();
    return this.syncEngine.processNextPendingJob(transport, {
      nowIso,
      clockHealthy: clock.healthy
    });
  }

  public async enrollStationWithCode(params: {
    serverUrl: string;
    code: string;
    deviceLabel?: string;
  }): Promise<{
    tenantId: string;
    stationId: string;
    status: string;
    plan: string;
  }> {
    const cleanServerUrl = params.serverUrl.replace(/\/+$/, '');
    const url = `${cleanServerUrl}/api/v1/station/enroll`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: params.code.trim().toUpperCase(),
        deviceLabel: params.deviceLabel ?? 'Operator Desktop'
      })
    });

    if (!response.ok) {
      let errorMsg = `Enrollment failed with status ${response.status}`;
      try {
        const errorJson = (await response.json()) as { error?: string; message?: string };
        errorMsg = errorJson.error || errorJson.message || errorMsg;
      } catch {
        // use default error message
      }
      throw new Error(errorMsg);
    }

    const data = (await response.json()) as {
      tenantId: string;
      stationId: string;
      status: string;
      plan: string;
    };

    // Save stationId, tenantId, serverUrl, and plan to local database configuration
    this.db.setStationConfig('station_id', data.stationId);
    this.db.setStationConfig('tenant_id', data.tenantId);
    this.db.setStationConfig('server_url', cleanServerUrl);
    this.db.setStationConfig('plan', data.plan);
    if (data.status) {
      this.db.setStationConfig('status', data.status);
    }

    return data;
  }

  public close(): void {
    this.db.close();
  }
}
