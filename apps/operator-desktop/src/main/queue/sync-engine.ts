import fs from 'node:fs';
import path from 'node:path';
import {
  computeBufferSha256,
  computeExponentialBackoffMs,
  computeScopedStoragePath,
  redactTokensFromText,
  type ApprovedSessionManifest,
  type DurableJob
} from '@odc-photostudio/contracts';
import type { StationDatabase } from '../db.js';

export interface CloudSyncTransport {
  registerSession(params: {
    idempotencyKey: string;
    manifest: ApprovedSessionManifest;
  }): Promise<{
    status: 'ok' | 'unauthorized' | 'forbidden_revoked' | 'expired' | 'transient_error';
    alreadyUploadedAssetIds?: string[];
    errorCode?: string;
  }>;

  uploadAssetObject(params: {
    tenantId: string;
    eventId: string;
    sessionId: string;
    assetId: string;
    storagePath: string;
    buffer: Buffer;
    sha256: string;
    mimeType: 'image/jpeg' | 'image/png';
  }): Promise<{
    status: 'ok' | 'conflict_mismatch' | 'unauthorized' | 'expired' | 'transient_error';
    errorCode?: string;
  }>;

  finalizeSession(params: {
    idempotencyKey: string;
    tenantId: string;
    eventId: string;
    sessionId: string;
    manifest: ApprovedSessionManifest;
  }): Promise<{
    status: 'published' | 'rejected_incomplete' | 'rejected_expired' | 'unauthorized' | 'transient_error';
    publishedAt?: string;
    errorCode?: string;
  }>;
}

export interface StartupReconciliationReport {
  interruptedPrintsMarkedUnknown: number;
  expiredSessionsCleanedLocally: number;
  abandonedSessionsCleaned: number;
  staleLeasesRecovered: number;
  corruptManifestsQuarantined: number;
  stagingFilesCleaned: number;
}

export class DurableSyncEngine {
  private readonly db: StationDatabase;
  private readonly workerId: string;

  constructor(db: StationDatabase, workerId = `worker-${process.pid}`) {
    this.db = db;
    this.workerId = workerId;
  }

  /**
   * Startup & Periodic Reconciliation (Section 7 & Section 9.3):
   * 1. Runs retention checks BEFORE resuming uploads or rendering media previews (A21).
   * 2. Deletes abandoned sessions older than 1 hour with no capture.
   * 3. Never infers an interrupted print ('submitting') was not printed -> marks 'unknown' (A05).
   * 4. Cleans leftover `.staging.` files from interrupted compositing/capture (A04).
   * 5. Quarantines sessions whose approved assets are missing or corrupt on disk.
   * 6. Recovers expired worker leases on `durable_jobs`.
   */
  public runStartupReconciliation(nowIso?: string): StartupReconciliationReport {
    const now = nowIso ?? new Date().toISOString();
    const nowMs = Date.parse(now);

    const report: StartupReconciliationReport = {
      interruptedPrintsMarkedUnknown: 0,
      expiredSessionsCleanedLocally: 0,
      abandonedSessionsCleaned: 0,
      staleLeasesRecovered: 0,
      corruptManifestsQuarantined: 0,
      stagingFilesCleaned: 0
    };

    // 1. Clean local expired sessions first (A21)
    const expiredSessions = this.db.db
      .prepare(
        `SELECT * FROM sessions
         WHERE expires_at IS NOT NULL
           AND expires_at <= ?
           AND deletion_state != 'deleted'`
      )
      .all(now) as Array<{
      session_id: string;
      session_dir: string;
      upload_state: string;
      deletion_state: string;
    }>;

    for (const s of expiredSessions) {
      this.deleteSessionLocalMedia(s.session_id, s.session_dir, now);
      report.expiredSessionsCleanedLocally += 1;
    }

    // 2. Clean abandoned sessions (>1 hour old with no first_captured_at) (Section 9.3)
    const oneHourAgoIso = new Date(nowMs - 60 * 60 * 1000).toISOString();
    const abandonedSessions = this.db.db
      .prepare(
        `SELECT session_id, session_dir, capture_state, deletion_state FROM sessions
         WHERE first_captured_at IS NULL
           AND created_at <= ?
           AND deletion_state != 'deleted'`
      )
      .all(oneHourAgoIso) as Array<{
      session_id: string;
      session_dir: string;
      capture_state: string;
      deletion_state: string;
    }>;

    for (const ab of abandonedSessions) {
      if (fs.existsSync(ab.session_dir)) {
        fs.rmSync(ab.session_dir, { recursive: true, force: true });
      }
      this.db.transaction(() => {
        if (ab.capture_state !== 'cancelled' && ab.capture_state !== 'approved') {
          this.db.updateCaptureState(
            ab.session_id,
            'cancelled',
            'Abandoned session cleaned after 1 hour timeout',
            now
          );
        }
        this.db.transitionDeletionState({
          sessionId: ab.session_id,
          toState: 'deleting',
          reason: 'Deleting abandoned session directory',
          nowIso: now
        });
        this.db.transitionDeletionState({
          sessionId: ab.session_id,
          toState: 'deleted',
          reason: 'Abandoned session media removed',
          nowIso: now
        });
      });
      report.abandonedSessionsCleaned += 1;
    }

    // 3. Mark any 'submitting' print attempts as 'unknown' — NEVER auto-reprint (A05)
    const interruptedPrints = this.db.db
      .prepare(`SELECT attempt_id FROM print_attempts WHERE state = 'submitting'`)
      .all() as Array<{ attempt_id: string }>;

    for (const attempt of interruptedPrints) {
      this.db.transitionPrintAttempt({
        attemptId: attempt.attempt_id,
        toState: 'unknown',
        diagnosticText:
          'Outcome unknown — application interrupted during print submission. Inspect printer before reprinting.',
        nowIso: now
      });
      report.interruptedPrintsMarkedUnknown += 1;
    }

    // 4. Reconcile active session directories, remove orphan .staging files, and verify approved manifests
    const activeSessions = this.db.db
      .prepare(`SELECT * FROM sessions WHERE deletion_state != 'deleted'`)
      .all() as Array<{
      session_id: string;
      session_dir: string;
      capture_state: string;
      composite_state: string;
      upload_state: string;
      manifest_json: string | null;
    }>;

    for (const s of activeSessions) {
      if (fs.existsSync(s.session_dir)) {
        for (const entry of fs.readdirSync(s.session_dir)) {
          if (entry.includes('.staging.')) {
            try {
              fs.unlinkSync(path.join(s.session_dir, entry));
              report.stagingFilesCleaned += 1;
            } catch {
              // ignore unlink error
            }
          }
        }
      }

      if (s.composite_state === 'rendering') {
        this.db.updateCompositeState(
          s.session_id,
          'failed',
          'Interrupted during composite rendering; operator can re-render from approved shots',
          now
        );
      }

      if (s.capture_state === 'approved' && s.manifest_json) {
        const assets = this.db.db
          .prepare(
            `SELECT * FROM session_assets WHERE session_id = ? AND is_approved = 1 AND is_superseded = 0`
          )
          .all(s.session_id) as Array<{
          asset_id: string;
          local_file_path: string;
          sha256: string;
        }>;

        let corrupted = false;
        for (const asset of assets) {
          if (!fs.existsSync(asset.local_file_path)) {
            corrupted = true;
            break;
          }
          const actualHash = computeBufferSha256(fs.readFileSync(asset.local_file_path));
          if (actualHash.toLowerCase() !== asset.sha256.toLowerCase()) {
            corrupted = true;
            break;
          }
        }

        if (corrupted && s.upload_state !== 'published' && s.upload_state !== 'failed') {
          this.db.transitionUploadState({
            sessionId: s.session_id,
            toState: 'failed',
            reason: 'QUARANTINED: Required local approved asset missing or SHA-256 checksum mismatch',
            nowIso: now
          });
          this.db.db
            .prepare(
              `UPDATE durable_jobs SET state = 'failed', error_code = 'ASSET_CORRUPT_OR_MISSING', updated_at = ?
               WHERE session_id = ?`
            )
            .run(now, s.session_id);
          report.corruptManifestsQuarantined += 1;
        }
      }
    }

    // 5. Recover expired worker leases on durable_jobs
    const staleJobs = this.db.db
      .prepare(
        `SELECT job_id FROM durable_jobs
         WHERE lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`
      )
      .all(now) as Array<{ job_id: string }>;

    if (staleJobs.length > 0) {
      this.db.db
        .prepare(
          `UPDATE durable_jobs
           SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
           WHERE lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?`
        )
        .run(now, now);
      report.staleLeasesRecovered = staleJobs.length;
    }

    return report;
  }

  public deleteSessionLocalMedia(
    sessionId: string,
    sessionDir: string,
    nowIso?: string
  ): void {
    const now = nowIso ?? new Date().toISOString();
    this.db.transaction(() => {
      const current = this.db.getSessionOrThrow(sessionId);

      if (current.deletion_state === 'not_due') {
        this.db.transitionDeletionState({
          sessionId,
          toState: 'due',
          reason: 'Session retention window reached (24h after first capture)',
          nowIso: now
        });
      }

      const afterDue = this.db.getSessionOrThrow(sessionId);
      if (afterDue.deletion_state === 'due' || afterDue.deletion_state === 'retry_scheduled') {
        this.db.transitionDeletionState({
          sessionId,
          toState: 'deleting',
          reason: 'Removing local originals, composite, and staged upload files',
          nowIso: now
        });
      }

      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }

      // If upload never finished before expiration, transition upload_state -> 'expired' (A10)
      if (current.upload_state !== 'expired') {
        this.db.transitionUploadState({
          sessionId,
          toState: 'expired',
          reason: 'Session reached 24-hour expiration deadline',
          nowIso: now
        });
      }

      // Cancel any pending durable jobs for this expired session
      this.db.db
        .prepare(
          `UPDATE durable_jobs
           SET state = 'expired', lease_owner = NULL, lease_expires_at = NULL,
               error_code = 'SESSION_EXPIRED', updated_at = ?
           WHERE session_id = ? AND state != 'published'`
        )
        .run(now, sessionId);

      this.db.transitionDeletionState({
        sessionId,
        toState: 'deleted',
        reason: 'Local session media deleted; non-photo audit record retained',
        nowIso: now
      });
    });
  }

  /**
   * Processes one queued upload job through the recoverable 3-step cloud publication pipeline:
   * Step 1: Register session & manifest with idempotency key
   * Step 2: Upload each approved asset to `{tenant_id}/{event_id}/{session_id}/{asset_id}.jpg`
   * Step 3: Verify & finalize publication idempotently
   */
  public async processNextPendingJob(
    transport: CloudSyncTransport,
    options: { nowIso?: string; clockHealthy?: boolean } = {}
  ): Promise<{ processed: boolean; sessionId?: string; finalState?: string }> {
    const now = options.nowIso ?? new Date().toISOString();
    const nowMs = Date.parse(now);

    if (options.clockHealthy === false) {
      // Section 9.1 / A20: Significant clock jump requires reconciliation before cloud publication
      return { processed: false };
    }

    // Lease next eligible job
    const jobRow = this.db.db
      .prepare(
        `SELECT * FROM durable_jobs
         WHERE state IN ('pending', 'retry_scheduled')
           AND next_attempt_at <= ?
           AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
         ORDER BY next_attempt_at ASC
         LIMIT 1`
      )
      .get(now, now) as Record<string, unknown> | undefined;

    if (!jobRow) {
      return { processed: false };
    }

    const job = this.db.mapDurableJobRow(jobRow);
    const session = this.db.getSessionOrThrow(job.sessionId);

    // If grant explicitly disables softCopyQr, do not upload session to cloud gallery (Plan §3)
    const prepared = this.db.getPreparedEventPackage(session.event_id);
    if (prepared && prepared.grant.payload.softCopyQr === false) {
      this.db.db
        .prepare(`UPDATE durable_jobs SET state = 'cancelled', updated_at = ? WHERE job_id = ?`)
        .run(now, job.jobId);
      return { processed: true, sessionId: session.session_id, finalState: 'cancelled' };
    }

    // Check expiration before starting upload (Section 8 & 9.1 / A10)
    if (session.expires_at && Date.parse(session.expires_at) <= nowMs) {
      this.deleteSessionLocalMedia(session.session_id, session.session_dir, now);
      return {
        processed: true,
        sessionId: session.session_id,
        finalState: 'expired'
      };
    }

    const leaseExpiresIso = new Date(nowMs + 60_000).toISOString();
    this.db.db
      .prepare(
        `UPDATE durable_jobs
         SET lease_owner = ?, lease_expires_at = ?, attempt_count = attempt_count + 1, updated_at = ?
         WHERE job_id = ?`
      )
      .run(this.workerId, leaseExpiresIso, now, job.jobId);

    if (!session.manifest_json) {
      this.markJobFailed(job.jobId, session.session_id, 'MISSING_MANIFEST', 'Session has no approved manifest', now);
      return { processed: true, sessionId: session.session_id, finalState: 'failed' };
    }

    const manifest = JSON.parse(session.manifest_json) as ApprovedSessionManifest;

    // Step 1: Register Session
    this.db.transitionUploadState({
      sessionId: session.session_id,
      toState: 'registering',
      reason: 'Registering approved session manifest with cloud endpoint',
      nowIso: now
    });

    const regResult = await transport.registerSession({
      idempotencyKey: job.idempotencyKey,
      manifest
    });

    if (regResult.status === 'unauthorized' || regResult.status === 'forbidden_revoked') {
      this.pauseJobForAuth(
        job.jobId,
        session.session_id,
        regResult.errorCode ?? regResult.status.toUpperCase(),
        'Upload paused: operator authentication expired or station/operator authorization revoked',
        now
      );
      return { processed: true, sessionId: session.session_id, finalState: 'blocked_auth' };
    }

    if (regResult.status === 'expired') {
      this.deleteSessionLocalMedia(session.session_id, session.session_dir, now);
      return { processed: true, sessionId: session.session_id, finalState: 'expired' };
    }

    if (regResult.status === 'transient_error') {
      this.scheduleRetry(
        job.jobId,
        session.session_id,
        job.attemptCount + 1,
        'REGISTER_TRANSIENT_ERROR',
        'Transient network error during session registration',
        now
      );
      return { processed: true, sessionId: session.session_id, finalState: 'retry_scheduled' };
    }

    // Step 2: Upload each approved asset
    this.db.transitionUploadState({
      sessionId: session.session_id,
      toState: 'uploading',
      reason: 'Uploading approved session shots and composite to private storage',
      nowIso: now
    });

    const alreadyUploaded = new Set(regResult.alreadyUploadedAssetIds ?? []);
    const localAssets = this.db.db
      .prepare(
        `SELECT * FROM session_assets WHERE session_id = ? AND is_approved = 1 AND is_superseded = 0`
      )
      .all(session.session_id) as Array<{
      asset_id: string;
      local_file_path: string;
      sha256: string;
    }>;

    const localAssetMap = new Map(localAssets.map((a) => [a.asset_id, a]));

    for (const manifestAsset of manifest.assets) {
      if (alreadyUploaded.has(manifestAsset.assetId)) {
        continue;
      }

      const localRow = localAssetMap.get(manifestAsset.assetId);
      if (!localRow || !fs.existsSync(localRow.local_file_path)) {
        this.markJobFailed(
          job.jobId,
          session.session_id,
          'MISSING_LOCAL_FILE',
          `Local file missing for asset ${manifestAsset.assetId}`,
          now
        );
        return { processed: true, sessionId: session.session_id, finalState: 'failed' };
      }

      const buffer = fs.readFileSync(localRow.local_file_path);
      const actualHash = computeBufferSha256(buffer);
      if (actualHash.toLowerCase() !== manifestAsset.sha256.toLowerCase()) {
        this.markJobFailed(
          job.jobId,
          session.session_id,
          'CHECKSUM_MISMATCH',
          `Checksum mismatch for asset ${manifestAsset.assetId}`,
          now
        );
        return { processed: true, sessionId: session.session_id, finalState: 'failed' };
      }

      const storagePath = computeScopedStoragePath({
        tenantId: manifest.tenantId,
        eventId: manifest.eventId,
        sessionId: manifest.sessionId,
        assetId: manifestAsset.assetId,
        extension: manifestAsset.mimeType === 'image/png' ? 'png' : 'jpg'
      });

      const uploadRes = await transport.uploadAssetObject({
        tenantId: manifest.tenantId,
        eventId: manifest.eventId,
        sessionId: manifest.sessionId,
        assetId: manifestAsset.assetId,
        storagePath,
        buffer,
        sha256: manifestAsset.sha256,
        mimeType: manifestAsset.mimeType
      });

      if (uploadRes.status === 'unauthorized') {
        this.pauseJobForAuth(
          job.jobId,
          session.session_id,
          'UPLOAD_UNAUTHORIZED',
          'Authentication expired during asset upload',
          now
        );
        return { processed: true, sessionId: session.session_id, finalState: 'blocked_auth' };
      }

      if (uploadRes.status === 'expired') {
        this.deleteSessionLocalMedia(session.session_id, session.session_dir, now);
        return { processed: true, sessionId: session.session_id, finalState: 'expired' };
      }

      if (uploadRes.status === 'conflict_mismatch') {
        this.markJobFailed(
          job.jobId,
          session.session_id,
          'IMMUTABLE_OBJECT_CONFLICT',
          `Cloud storage rejected conflicting bytes for immutable object ${storagePath}`,
          now
        );
        return { processed: true, sessionId: session.session_id, finalState: 'failed' };
      }

      if (uploadRes.status === 'transient_error') {
        this.scheduleRetry(
          job.jobId,
          session.session_id,
          job.attemptCount + 1,
          'ASSET_UPLOAD_TRANSIENT_ERROR',
          `Transient failure uploading asset ${manifestAsset.assetId}`,
          now
        );
        return { processed: true, sessionId: session.session_id, finalState: 'retry_scheduled' };
      }
    }

    // Step 3: Verify and Finalize Publication
    this.db.transitionUploadState({
      sessionId: session.session_id,
      toState: 'verifying',
      reason: 'Verifying uploaded objects and finalizing gallery publication',
      nowIso: now
    });

    const finalizeRes = await transport.finalizeSession({
      idempotencyKey: `fin:${session.session_id}:v${manifest.manifestVersion}`,
      tenantId: manifest.tenantId,
      eventId: manifest.eventId,
      sessionId: manifest.sessionId,
      manifest
    });

    if (finalizeRes.status === 'published') {
      this.db.transaction(() => {
        this.db.transitionUploadState({
          sessionId: session.session_id,
          toState: 'published',
          reason: 'Gallery verified and published',
          nowIso: now
        });
        this.db.db
          .prepare(
            `UPDATE durable_jobs
             SET state = 'published', lease_owner = NULL, lease_expires_at = NULL,
                 error_code = NULL, diagnostic_text = NULL, updated_at = ?
             WHERE job_id = ?`
          )
          .run(now, job.jobId);
      });
      return { processed: true, sessionId: session.session_id, finalState: 'published' };
    }

    if (finalizeRes.status === 'rejected_expired') {
      this.deleteSessionLocalMedia(session.session_id, session.session_dir, now);
      return { processed: true, sessionId: session.session_id, finalState: 'expired' };
    }

    if (finalizeRes.status === 'unauthorized') {
      this.pauseJobForAuth(
        job.jobId,
        session.session_id,
        'FINALIZE_UNAUTHORIZED',
        'Authentication expired or revoked during finalization',
        now
      );
      return { processed: true, sessionId: session.session_id, finalState: 'blocked_auth' };
    }

    this.scheduleRetry(
      job.jobId,
      session.session_id,
      job.attemptCount + 1,
      finalizeRes.errorCode ?? 'FINALIZE_RETRY',
      `Finalization deferred (${finalizeRes.status}); scheduled retry`,
      now
    );
    return { processed: true, sessionId: session.session_id, finalState: 'retry_scheduled' };
  }

  public resumeAuthBlockedJobs(nowIso?: string): number {
    const now = nowIso ?? new Date().toISOString();
    const blocked = this.db.db
      .prepare(`SELECT job_id, session_id FROM durable_jobs WHERE state = 'blocked_auth'`)
      .all() as Array<{ job_id: string; session_id: string }>;

    this.db.transaction(() => {
      for (const b of blocked) {
        this.db.transitionUploadState({
          sessionId: b.session_id,
          toState: 'pending',
          reason: 'Operator reauthenticated; resuming upload job',
          nowIso: now
        });
        this.db.db
          .prepare(
            `UPDATE durable_jobs
             SET state = 'pending', next_attempt_at = ?, lease_owner = NULL, lease_expires_at = NULL,
                 error_code = NULL, updated_at = ?
             WHERE job_id = ?`
          )
          .run(now, now, b.job_id);
      }
    });

    return blocked.length;
  }

  private scheduleRetry(
    jobId: string,
    sessionId: string,
    attemptCount: number,
    errorCode: string,
    diagnosticText: string,
    nowIso: string
  ): void {
    const backoffMs = computeExponentialBackoffMs(attemptCount, 0);
    const nextAttemptIso = new Date(Date.parse(nowIso) + backoffMs).toISOString();

    this.db.transaction(() => {
      const session = this.db.getSessionOrThrow(sessionId);
      // Never schedule retry past session expiration (Section 8)
      if (session.expires_at && Date.parse(nextAttemptIso) >= Date.parse(session.expires_at)) {
        this.deleteSessionLocalMedia(sessionId, session.session_dir, nowIso);
        return;
      }

      this.db.transitionUploadState({
        sessionId,
        toState: 'retry_scheduled',
        reason: `${errorCode}: ${diagnosticText} (next attempt at ${nextAttemptIso})`,
        nowIso
      });

      this.db.db
        .prepare(
          `UPDATE durable_jobs
           SET state = 'retry_scheduled',
               next_attempt_at = ?,
               lease_owner = NULL,
               lease_expires_at = NULL,
               error_code = ?,
               diagnostic_text = ?,
               updated_at = ?
           WHERE job_id = ?`
        )
        .run(
          nextAttemptIso,
          errorCode,
          redactTokensFromText(diagnosticText),
          nowIso,
          jobId
        );
    });
  }

  private pauseJobForAuth(
    jobId: string,
    sessionId: string,
    errorCode: string,
    diagnosticText: string,
    nowIso: string
  ): void {
    this.db.transaction(() => {
      this.db.transitionUploadState({
        sessionId,
        toState: 'blocked_auth',
        reason: `${errorCode}: ${diagnosticText}`,
        nowIso
      });
      this.db.db
        .prepare(
          `UPDATE durable_jobs
           SET state = 'blocked_auth',
               lease_owner = NULL,
               lease_expires_at = NULL,
               error_code = ?,
               diagnostic_text = ?,
               updated_at = ?
           WHERE job_id = ?`
        )
        .run(errorCode, redactTokensFromText(diagnosticText), nowIso, jobId);
    });
  }

  private markJobFailed(
    jobId: string,
    sessionId: string,
    errorCode: string,
    diagnosticText: string,
    nowIso: string
  ): void {
    this.db.transaction(() => {
      this.db.transitionUploadState({
        sessionId,
        toState: 'failed',
        reason: `${errorCode}: ${diagnosticText}`,
        nowIso
      });
      this.db.db
        .prepare(
          `UPDATE durable_jobs
           SET state = 'failed',
               lease_owner = NULL,
               lease_expires_at = NULL,
               error_code = ?,
               diagnostic_text = ?,
               updated_at = ?
           WHERE job_id = ?`
        )
        .run(errorCode, redactTokensFromText(diagnosticText), nowIso, jobId);
    });
  }
}
