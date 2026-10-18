import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  assertValidTransition,
  computeSessionExpirationIso,
  redactTokensFromText,
  type ApprovedSessionManifest,
  type CaptureState,
  type CompositeState,
  type DeletionState,
  type DurableJob,
  type DurableJobType,
  type PrintAttemptState,
  type SignedOfflineGrant,
  type StateTrackName,
  type UploadState
} from '@odc-photostudio/contracts';

export interface LocalSessionRow {
  session_id: string;
  tenant_id: string;
  event_id: string;
  station_id: string;
  operator_id: string;
  template_version_id: string;
  gallery_token_protected: string;
  token_hash: string;
  session_dir: string;
  capture_state: CaptureState;
  composite_state: CompositeState;
  upload_state: UploadState;
  deletion_state: DeletionState;
  first_captured_at: string | null;
  approved_at: string | null;
  expires_at: string | null;
  manifest_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalAssetRow {
  asset_id: string;
  session_id: string;
  kind: 'shot' | 'composite';
  frame_index: number | null;
  local_file_path: string;
  width: number;
  height: number;
  byte_size: number;
  sha256: string;
  is_approved: number;
  is_superseded: number;
  created_at: string;
}

export interface LocalPrintAttemptRow {
  attempt_id: string;
  session_id: string;
  print_profile_id: string;
  copies: number;
  is_reprint: number;
  state: PrintAttemptState;
  diagnostic_text: string | null;
  created_at: string;
  updated_at: string;
}

export class StationDatabase {
  public readonly db: DatabaseSync;
  public readonly dbPath: string;
  private readonly lockFilePath: string;
  private transactionDepth = 0;

  constructor(dataDir: string, stationId: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.lockFilePath = path.join(dataDir, `station-${stationId}.lock`);
    this.acquireSingleInstanceLock(stationId);

    this.dbPath = path.join(dataDir, `station-${stationId}.sqlite`);
    this.db = new DatabaseSync(this.dbPath);
    this.initializeSchema();
  }

  private acquireSingleInstanceLock(stationId: string): void {
    if (fs.existsSync(this.lockFilePath)) {
      const existingContent = fs.readFileSync(this.lockFilePath, 'utf8').trim();
      const [pidStr] = existingContent.split(':');
      const pid = Number(pidStr);
      if (pid && pid !== process.pid) {
        try {
          process.kill(pid, 0);
          throw new Error(
            `Station ${stationId} database is already locked by active process PID ${pid}`
          );
        } catch (err: unknown) {
          if (err instanceof Error && err.message.includes('already locked')) {
            throw err;
          }
          // Process is no longer alive; reclaim stale lock
        }
      }
    }
    fs.writeFileSync(this.lockFilePath, `${process.pid}:${new Date().toISOString()}`, 'utf8');
  }

  public close(): void {
    try {
      this.db.close();
    } finally {
      if (fs.existsSync(this.lockFilePath)) {
        try {
          fs.unlinkSync(this.lockFilePath);
        } catch {
          // ignore cleanup failure
        }
      }
    }
  }

  public transaction<T>(fn: () => T): T {
    if (this.transactionDepth > 0) {
      this.transactionDepth += 1;
      try {
        return fn();
      } finally {
        this.transactionDepth -= 1;
      }
    }

    this.transactionDepth = 1;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    } finally {
      this.transactionDepth = 0;
    }
  }

  private initializeSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cached_event_packages (
        event_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        station_id TEXT NOT NULL,
        operator_id TEXT NOT NULL,
        package_json TEXT NOT NULL,
        grant_json TEXT NOT NULL,
        server_time_offset_ms INTEGER NOT NULL,
        prepared_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        station_id TEXT NOT NULL,
        operator_id TEXT NOT NULL,
        template_version_id TEXT NOT NULL,
        gallery_token_protected TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        session_dir TEXT NOT NULL,
        capture_state TEXT NOT NULL,
        composite_state TEXT NOT NULL,
        upload_state TEXT NOT NULL,
        deletion_state TEXT NOT NULL,
        first_captured_at TEXT,
        approved_at TEXT,
        expires_at TEXT,
        manifest_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_assets (
        asset_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('shot', 'composite')),
        frame_index INTEGER,
        local_file_path TEXT NOT NULL,
        width INTEGER NOT NULL CHECK (width > 0),
        height INTEGER NOT NULL CHECK (height > 0),
        byte_size INTEGER NOT NULL CHECK (byte_size > 0),
        sha256 TEXT NOT NULL,
        is_approved INTEGER NOT NULL DEFAULT 0,
        is_superseded INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS print_attempts (
        attempt_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        print_profile_id TEXT NOT NULL,
        copies INTEGER NOT NULL CHECK (copies >= 1 AND copies <= 10),
        is_reprint INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL,
        diagnostic_text TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS durable_jobs (
        job_id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        station_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        manifest_version INTEGER NOT NULL,
        state TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        lease_owner TEXT,
        lease_expires_at TEXT,
        error_code TEXT,
        diagnostic_text TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS state_transitions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        track TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        reason TEXT NOT NULL,
        transitioned_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS operational_audit_logs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        station_id TEXT NOT NULL,
        session_id TEXT,
        action TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_tenant_event ON sessions(tenant_id, event_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_durable_jobs_next_attempt ON durable_jobs(state, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_print_attempts_session ON print_attempts(session_id, created_at);
    `);

    const insertMigration = this.db.prepare(
      `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)`
    );
    insertMigration.run(1, new Date().toISOString());
  }

  public recordTransition(params: {
    sessionId: string;
    track: StateTrackName;
    fromState: string;
    toState: string;
    reason: string;
    nowIso?: string;
  }): void {
    assertValidTransition(params.track, params.fromState, params.toState);
    const now = params.nowIso ?? new Date().toISOString();
    const redactedReason = redactTokensFromText(params.reason);

    const stmt = this.db.prepare(`
      INSERT INTO state_transitions (id, session_id, track, from_state, to_state, reason, transitioned_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      crypto.randomUUID(),
      params.sessionId,
      params.track,
      params.fromState,
      params.toState,
      redactedReason,
      now
    );
  }

  public savePreparedEventPackage(params: {
    eventId: string;
    tenantId: string;
    stationId: string;
    operatorId: string;
    packageJson: string;
    grant: SignedOfflineGrant;
    serverTimeOffsetMs: number;
    nowIso?: string;
  }): void {
    const now = params.nowIso ?? new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO cached_event_packages
      (event_id, tenant_id, station_id, operator_id, package_json, grant_json, server_time_offset_ms, prepared_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      params.eventId,
      params.tenantId,
      params.stationId,
      params.operatorId,
      params.packageJson,
      JSON.stringify(params.grant),
      params.serverTimeOffsetMs,
      now
    );
  }

  public getPreparedEventPackage(eventId: string): {
    tenantId: string;
    stationId: string;
    operatorId: string;
    packageJson: string;
    grant: SignedOfflineGrant;
    serverTimeOffsetMs: number;
    preparedAt: string;
  } | null {
    const stmt = this.db.prepare(`SELECT * FROM cached_event_packages WHERE event_id = ?`);
    const row = stmt.get(eventId) as
      | {
          tenant_id: string;
          station_id: string;
          operator_id: string;
          package_json: string;
          grant_json: string;
          server_time_offset_ms: number;
          prepared_at: string;
        }
      | undefined;

    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      stationId: row.station_id,
      operatorId: row.operator_id,
      packageJson: row.package_json,
      grant: JSON.parse(row.grant_json) as SignedOfflineGrant,
      serverTimeOffsetMs: row.server_time_offset_ms,
      preparedAt: row.prepared_at
    };
  }

  public createSession(params: {
    sessionId: string;
    tenantId: string;
    eventId: string;
    stationId: string;
    operatorId: string;
    templateVersionId: string;
    galleryTokenProtected: string;
    tokenHash: string;
    sessionDir: string;
    nowIso?: string;
  }): LocalSessionRow {
    const now = params.nowIso ?? new Date().toISOString();
    return this.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT INTO sessions (
          session_id, tenant_id, event_id, station_id, operator_id, template_version_id,
          gallery_token_protected, token_hash, session_dir,
          capture_state, composite_state, upload_state, deletion_state,
          first_captured_at, approved_at, expires_at, manifest_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', 'pending', 'pending', 'not_due', NULL, NULL, NULL, NULL, ?, ?)
      `);
      stmt.run(
        params.sessionId,
        params.tenantId,
        params.eventId,
        params.stationId,
        params.operatorId,
        params.templateVersionId,
        params.galleryTokenProtected,
        params.tokenHash,
        params.sessionDir,
        now,
        now
      );
      return this.getSessionOrThrow(params.sessionId);
    });
  }

  public getSession(sessionId: string): LocalSessionRow | null {
    const stmt = this.db.prepare(`SELECT * FROM sessions WHERE session_id = ?`);
    const row = stmt.get(sessionId) as LocalSessionRow | undefined;
    return row ?? null;
  }

  public getSessionOrThrow(sessionId: string): LocalSessionRow {
    const row = this.getSession(sessionId);
    if (!row) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return row;
  }

  public listSessionsForEvent(tenantId: string, eventId: string): LocalSessionRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM sessions WHERE tenant_id = ? AND event_id = ? ORDER BY created_at DESC`
    );
    return stmt.all(tenantId, eventId) as unknown as LocalSessionRow[];
  }

  public updateCaptureState(
    sessionId: string,
    toState: CaptureState,
    reason: string,
    nowIso?: string
  ): LocalSessionRow {
    const now = nowIso ?? new Date().toISOString();
    return this.transaction(() => {
      const current = this.getSessionOrThrow(sessionId);
      if (current.capture_state === toState && toState !== 'capturing') {
        return current;
      }
      this.recordTransition({
        sessionId,
        track: 'capture',
        fromState: current.capture_state,
        toState,
        reason,
        nowIso: now
      });
      this.db
        .prepare(`UPDATE sessions SET capture_state = ?, updated_at = ? WHERE session_id = ?`)
        .run(toState, now, sessionId);
      return this.getSessionOrThrow(sessionId);
    });
  }

  public recordCapturedShot(params: {
    sessionId: string;
    assetId: string;
    frameIndex: number;
    localFilePath: string;
    width: number;
    height: number;
    byteSize: number;
    sha256: string;
    capturedAtIso: string;
  }): { session: LocalSessionRow; supersededAssetPaths: string[] } {
    return this.transaction(() => {
      const session = this.getSessionOrThrow(params.sessionId);

      // Authoritative rule (Section 6.2 & 9.1):
      // First successful shot sets first_captured_at and expires_at (+24h).
      // Retakes NEVER extend expires_at.
      let firstCapturedAt = session.first_captured_at;
      let expiresAt = session.expires_at;
      if (!firstCapturedAt) {
        firstCapturedAt = params.capturedAtIso;
        expiresAt = computeSessionExpirationIso(firstCapturedAt);
      }

      // Mark any prior shot for the same frameIndex as superseded
      const priorShots = this.db
        .prepare(
          `SELECT asset_id, local_file_path FROM session_assets
           WHERE session_id = ? AND kind = 'shot' AND frame_index = ? AND is_superseded = 0`
        )
        .all(params.sessionId, params.frameIndex) as unknown as Array<{
        asset_id: string;
        local_file_path: string;
      }>;

      if (priorShots.length > 0) {
        this.db
          .prepare(
            `UPDATE session_assets SET is_superseded = 1, is_approved = 0
             WHERE session_id = ? AND kind = 'shot' AND frame_index = ?`
          )
          .run(params.sessionId, params.frameIndex);
      }

      this.db
        .prepare(
          `INSERT INTO session_assets (
            asset_id, session_id, kind, frame_index, local_file_path,
            width, height, byte_size, sha256, is_approved, is_superseded, created_at
          ) VALUES (?, ?, 'shot', ?, ?, ?, ?, ?, ?, 1, 0, ?)`
        )
        .run(
          params.assetId,
          params.sessionId,
          params.frameIndex,
          params.localFilePath,
          params.width,
          params.height,
          params.byteSize,
          params.sha256,
          params.capturedAtIso
        );

      this.db
        .prepare(
          `UPDATE sessions
           SET first_captured_at = ?, expires_at = ?, updated_at = ?
           WHERE session_id = ?`
        )
        .run(firstCapturedAt, expiresAt, params.capturedAtIso, params.sessionId);

      return {
        session: this.getSessionOrThrow(params.sessionId),
        supersededAssetPaths: priorShots.map((s) => s.local_file_path)
      };
    });
  }

  public getActiveSessionShots(sessionId: string): LocalAssetRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM session_assets
       WHERE session_id = ? AND kind = 'shot' AND is_superseded = 0
       ORDER BY frame_index ASC`
    );
    return stmt.all(sessionId) as unknown as LocalAssetRow[];
  }

  public getSessionCompositeAsset(sessionId: string): LocalAssetRow | null {
    const stmt = this.db.prepare(
      `SELECT * FROM session_assets
       WHERE session_id = ? AND kind = 'composite' AND is_superseded = 0
       LIMIT 1`
    );
    const row = stmt.get(sessionId) as LocalAssetRow | undefined;
    return row ?? null;
  }

  public updateCompositeState(
    sessionId: string,
    toState: CompositeState,
    reason: string,
    nowIso?: string
  ): LocalSessionRow {
    const now = nowIso ?? new Date().toISOString();
    return this.transaction(() => {
      const current = this.getSessionOrThrow(sessionId);
      this.recordTransition({
        sessionId,
        track: 'composite',
        fromState: current.composite_state,
        toState,
        reason,
        nowIso: now
      });
      this.db
        .prepare(`UPDATE sessions SET composite_state = ?, updated_at = ? WHERE session_id = ?`)
        .run(toState, now, sessionId);
      return this.getSessionOrThrow(sessionId);
    });
  }

  /**
   * Atomic Approval & Enqueue Transaction (Section 6.4):
   * In ONE SQLite transaction:
   * - Stores composite asset record
   * - Transitions capture_state -> 'approved' and composite_state -> 'ready'
   * - Persists the ApprovedSessionManifest
   * - Enqueues durable upload job (`register_session`)
   */
  public commitApprovedSessionAndEnqueueUpload(params: {
    sessionId: string;
    compositeAsset: {
      assetId: string;
      localFilePath: string;
      width: number;
      height: number;
      byteSize: number;
      sha256: string;
    };
    manifest: ApprovedSessionManifest;
    approvedAtIso: string;
  }): { session: LocalSessionRow; job: DurableJob } {
    return this.transaction(() => {
      const current = this.getSessionOrThrow(params.sessionId);

      if (current.capture_state !== 'reviewing') {
        throw new Error(
          `Session ${params.sessionId} must be in "reviewing" state before approval (current: ${current.capture_state})`
        );
      }

      // Mark composite asset
      this.db
        .prepare(
          `UPDATE session_assets SET is_superseded = 1 WHERE session_id = ? AND kind = 'composite'`
        )
        .run(params.sessionId);

      this.db
        .prepare(
          `INSERT INTO session_assets (
            asset_id, session_id, kind, frame_index, local_file_path,
            width, height, byte_size, sha256, is_approved, is_superseded, created_at
          ) VALUES (?, ?, 'composite', NULL, ?, ?, ?, ?, ?, 1, 0, ?)`
        )
        .run(
          params.compositeAsset.assetId,
          params.sessionId,
          params.compositeAsset.localFilePath,
          params.compositeAsset.width,
          params.compositeAsset.height,
          params.compositeAsset.byteSize,
          params.compositeAsset.sha256,
          params.approvedAtIso
        );

      this.recordTransition({
        sessionId: params.sessionId,
        track: 'capture',
        fromState: current.capture_state,
        toState: 'approved',
        reason: 'Operator approved session frames and composite',
        nowIso: params.approvedAtIso
      });

      this.recordTransition({
        sessionId: params.sessionId,
        track: 'composite',
        fromState: current.composite_state,
        toState: 'ready',
        reason: 'Composite validated and atomically moved to final path',
        nowIso: params.approvedAtIso
      });

      this.db
        .prepare(
          `UPDATE sessions
           SET capture_state = 'approved',
               composite_state = 'ready',
               approved_at = ?,
               manifest_json = ?,
               updated_at = ?
           WHERE session_id = ?`
        )
        .run(
          params.approvedAtIso,
          JSON.stringify(params.manifest),
          params.approvedAtIso,
          params.sessionId
        );

      const jobId = crypto.randomUUID();
      const idempotencyKey = `reg:${params.sessionId}:v${params.manifest.manifestVersion}`;

      this.db
        .prepare(
          `INSERT OR IGNORE INTO durable_jobs (
            job_id, job_type, session_id, tenant_id, event_id, station_id,
            idempotency_key, manifest_version, state, attempt_count,
            next_attempt_at, lease_owner, lease_expires_at, error_code, diagnostic_text,
            created_at, updated_at
          ) VALUES (?, 'register_session', ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, NULL, ?, ?)`
        )
        .run(
          jobId,
          params.sessionId,
          current.tenant_id,
          current.event_id,
          current.station_id,
          idempotencyKey,
          params.manifest.manifestVersion,
          params.approvedAtIso,
          params.approvedAtIso,
          params.approvedAtIso
        );

      const jobRow = this.db
        .prepare(`SELECT * FROM durable_jobs WHERE idempotency_key = ?`)
        .get(idempotencyKey) as Record<string, unknown>;

      return {
        session: this.getSessionOrThrow(params.sessionId),
        job: this.mapDurableJobRow(jobRow)
      };
    });
  }

  public createPrintAttempt(params: {
    sessionId: string;
    printProfileId: string;
    copies: number;
    isReprint: boolean;
    nowIso?: string;
  }): LocalPrintAttemptRow {
    const now = params.nowIso ?? new Date().toISOString();
    return this.transaction(() => {
      const session = this.getSessionOrThrow(params.sessionId);
      if (session.capture_state !== 'approved' || session.composite_state !== 'ready') {
        throw new Error(
          'Cannot create print attempt before session approval and composite readiness commit'
        );
      }

      // Check that no existing print attempt is in 'unknown' or 'submitting' state without operator resolution
      const unresolved = this.db
        .prepare(
          `SELECT attempt_id, state FROM print_attempts
           WHERE session_id = ? AND state IN ('submitting', 'unknown')`
        )
        .get(params.sessionId) as { attempt_id: string; state: string } | undefined;

      if (unresolved) {
        throw new Error(
          `Print blocked: existing print attempt ${unresolved.attempt_id} is in "${unresolved.state}" state and requires operator inspection`
        );
      }

      const attemptId = crypto.randomUUID();
      this.db
        .prepare(
          `INSERT INTO print_attempts (
            attempt_id, session_id, print_profile_id, copies, is_reprint,
            state, diagnostic_text, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'queued', NULL, ?, ?)`
        )
        .run(
          attemptId,
          params.sessionId,
          params.printProfileId,
          params.copies,
          params.isReprint ? 1 : 0,
          now,
          now
        );

      return this.getPrintAttemptOrThrow(attemptId);
    });
  }

  public transitionPrintAttempt(params: {
    attemptId: string;
    toState: PrintAttemptState;
    diagnosticText?: string | null;
    nowIso?: string;
  }): LocalPrintAttemptRow {
    const now = params.nowIso ?? new Date().toISOString();
    return this.transaction(() => {
      const current = this.getPrintAttemptOrThrow(params.attemptId);
      this.recordTransition({
        sessionId: current.session_id,
        track: 'print',
        fromState: current.state,
        toState: params.toState,
        reason: params.diagnosticText ?? `Print transition to ${params.toState}`,
        nowIso: now
      });

      this.db
        .prepare(
          `UPDATE print_attempts
           SET state = ?, diagnostic_text = ?, updated_at = ?
           WHERE attempt_id = ?`
        )
        .run(
          params.toState,
          params.diagnosticText ? redactTokensFromText(params.diagnosticText) : null,
          now,
          params.attemptId
        );

      return this.getPrintAttemptOrThrow(params.attemptId);
    });
  }

  public getPrintAttemptOrThrow(attemptId: string): LocalPrintAttemptRow {
    const row = this.db
      .prepare(`SELECT * FROM print_attempts WHERE attempt_id = ?`)
      .get(attemptId) as LocalPrintAttemptRow | undefined;
    if (!row) {
      throw new Error(`Print attempt not found: ${attemptId}`);
    }
    return row;
  }

  public listPrintAttemptsForSession(sessionId: string): LocalPrintAttemptRow[] {
    return this.db
      .prepare(`SELECT * FROM print_attempts WHERE session_id = ? ORDER BY created_at DESC`)
      .all(sessionId) as unknown as LocalPrintAttemptRow[];
  }

  public transitionUploadState(params: {
    sessionId: string;
    toState: UploadState;
    reason: string;
    nowIso?: string;
  }): LocalSessionRow {
    const now = params.nowIso ?? new Date().toISOString();
    return this.transaction(() => {
      const current = this.getSessionOrThrow(params.sessionId);
      if (current.upload_state === params.toState) {
        return current;
      }
      this.recordTransition({
        sessionId: params.sessionId,
        track: 'upload',
        fromState: current.upload_state,
        toState: params.toState,
        reason: params.reason,
        nowIso: now
      });
      this.db
        .prepare(`UPDATE sessions SET upload_state = ?, updated_at = ? WHERE session_id = ?`)
        .run(params.toState, now, params.sessionId);
      return this.getSessionOrThrow(params.sessionId);
    });
  }

  public transitionDeletionState(params: {
    sessionId: string;
    toState: DeletionState;
    reason: string;
    nowIso?: string;
  }): LocalSessionRow {
    const now = params.nowIso ?? new Date().toISOString();
    return this.transaction(() => {
      const current = this.getSessionOrThrow(params.sessionId);
      if (current.deletion_state === params.toState) {
        return current;
      }
      this.recordTransition({
        sessionId: params.sessionId,
        track: 'deletion',
        fromState: current.deletion_state,
        toState: params.toState,
        reason: params.reason,
        nowIso: now
      });
      this.db
        .prepare(`UPDATE sessions SET deletion_state = ?, updated_at = ? WHERE session_id = ?`)
        .run(params.toState, now, params.sessionId);
      return this.getSessionOrThrow(params.sessionId);
    });
  }

  public mapDurableJobRow(row: Record<string, unknown>): DurableJob {
    return {
      jobId: String(row.job_id),
      jobType: row.job_type as DurableJobType,
      sessionId: String(row.session_id),
      tenantId: String(row.tenant_id),
      eventId: String(row.event_id),
      stationId: String(row.station_id),
      idempotencyKey: String(row.idempotency_key),
      manifestVersion: Number(row.manifest_version),
      state: row.state as UploadState,
      attemptCount: Number(row.attempt_count),
      nextAttemptAt: String(row.next_attempt_at),
      leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
      leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : null,
      errorCode: row.error_code ? String(row.error_code) : null,
      diagnosticText: row.diagnostic_text ? String(row.diagnostic_text) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }
}
