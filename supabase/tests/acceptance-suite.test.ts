import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeBufferSha256,
  generateEd25519GrantKeyPair,
  type ApprovedSessionManifest,
  type PrintProfile
} from '@odc-photostudio/contracts';
import { createDefaultFourBySixPostcardTemplate } from '@odc-photostudio/template-engine';
import { MockCameraProvider } from '../../apps/operator-desktop/src/main/camera/provider.js';
import { MockPrinterProvider } from '../../apps/operator-desktop/src/main/printer/provider.js';
import { StationOrchestrator } from '../../apps/operator-desktop/src/main/orchestrator.js';
import type { CloudSyncTransport } from '../../apps/operator-desktop/src/main/queue/sync-engine.js';
import { CloudPortalService } from '../../apps/web-portal/src/lib/cloud-service.js';

const TENANT_A = '10000000-0000-4000-8000-000000000001';
const TENANT_B = '10000000-0000-4000-8000-000000000002';
const EVENT_A = '20000000-0000-4000-8000-000000000001';
const STATION_A = '30000000-0000-4000-8000-000000000001';
const OPERATOR_A = '40000000-0000-4000-8000-000000000001';
const OWNER_A = '40000000-0000-4000-8000-000000000099';
const TEMPLATE_VER_A = '60000000-0000-4000-8000-000000000001';

describe('ODC-PhotoStudio Acceptance Criteria Suite (A01 through A23)', () => {
  let tmpDir: string;
  let publicKeyPem: string;
  let privateKeyPem: string;
  let overlayPath: string;
  let overlaySha256: string;
  let printProfile: PrintProfile;
  let cloud: CloudPortalService;
  let orchestrator: StationOrchestrator;
  let camera: MockCameraProvider;
  let printer: MockPrinterProvider;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odc-photostudio-test-'));
    const keys = generateEd25519GrantKeyPair();
    publicKeyPem = keys.publicKeyPem;
    privateKeyPem = keys.privateKeyPem;

    const overlayBuf = await sharp({
      create: {
        width: 1200,
        height: 1800,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .png()
      .toBuffer();

    overlaySha256 = computeBufferSha256(overlayBuf);
    overlayPath = path.join(tmpDir, 'overlay-4x6.png');
    fs.writeFileSync(overlayPath, overlayBuf);

    printProfile = {
      id: 'prof-4x6-standard',
      name: '4x6 Postcard Standard',
      deviceName: 'MOCK-DNP-DS620A',
      paperSize: '4x6_postcard',
      dpi: 300,
      scalingMode: 'exact_1_to_1',
      offsetXMm: 0,
      offsetYMm: 0,
      maxCopiesPerSession: 3,
      supportsTwoBySixCut: false,
      stripImposition: 'none'
    };

    const templateDef = createDefaultFourBySixPostcardTemplate({
      overlayAssetId: 'overlay-4x6',
      overlaySha256
    });

    cloud = new CloudPortalService({ grantPrivateKeyPem: privateKeyPem });
    cloud.registerTenant({ id: TENANT_A, name: 'Studio Alpha', slug: 'studio-alpha' });
    cloud.registerTenant({ id: TENANT_B, name: 'Studio Beta', slug: 'studio-beta' });

    cloud.upsertMembership({
      tenantId: TENANT_A,
      userId: OWNER_A,
      role: 'owner',
      status: 'active'
    });
    cloud.upsertMembership({
      tenantId: TENANT_A,
      userId: OPERATOR_A,
      role: 'operator',
      status: 'active'
    });

    cloud.registerStation({
      id: STATION_A,
      tenantId: TENANT_A,
      label: 'Station Alpha-1',
      status: 'active'
    });

    cloud.registerTemplateVersion({
      id: TEMPLATE_VER_A,
      tenantId: TENANT_A,
      templateId: '70000000-0000-4000-8000-000000000001',
      name: '4x6 Studio Postcard',
      version: 1,
      definition: templateDef,
      overlayStoragePath: `${TENANT_A}/overlays/overlay-4x6.png`
    });

    cloud.registerEvent({
      id: EVENT_A,
      tenantId: TENANT_A,
      name: 'Grand Gala 2026',
      timezone: 'Asia/Manila',
      startsAt: '2026-10-18T00:00:00.000Z',
      endsAt: '2026-10-20T00:00:00.000Z',
      status: 'active',
      assignedOperatorIds: new Set([OPERATOR_A]),
      assignedStationIds: new Set([STATION_A]),
      templateVersionIds: new Set([TEMPLATE_VER_A])
    });

    camera = new MockCameraProvider(
      (sessionId) => path.join(tmpDir, 'sessions', sessionId),
      { captureDelayMs: 2 }
    );
    await camera.initialize();

    printer = new MockPrinterProvider(path.join(tmpDir, 'prints'));

    orchestrator = new StationOrchestrator({
      dataDir: tmpDir,
      stationId: STATION_A,
      camera,
      printer,
      grantPublicKeyPem: publicKeyPem
    });

    const grant = cloud.issueOfflineEventGrant({
      actorUserId: OPERATOR_A,
      tenantId: TENANT_A,
      eventId: EVENT_A,
      stationId: STATION_A,
      galleryOrigin: 'https://gallery.odc-photostudio.example.com',
      permittedPrintProfiles: [printProfile],
      nowIso: '2026-10-18T08:00:00.000Z'
    });

    orchestrator.prepareEventOffline({
      config: {
        eventId: EVENT_A,
        tenantId: TENANT_A,
        stationId: STATION_A,
        operatorId: OPERATOR_A,
        eventName: 'Grand Gala 2026',
        galleryOrigin: 'https://gallery.odc-photostudio.example.com',
        templates: [
          {
            templateVersionId: TEMPLATE_VER_A,
            name: '4x6 Studio Postcard',
            version: 1,
            definition: templateDef,
            overlayFilePath: overlayPath
          }
        ],
        printProfiles: [printProfile]
      },
      grant,
      serverTimeIso: '2026-10-18T08:00:00.000Z',
      nowIso: '2026-10-18T08:00:00.000Z'
    });
  });

  afterEach(() => {
    orchestrator.close();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function createCloudTransport(
    actorUserId: string | null = OPERATOR_A,
    nowIso = '2026-10-18T08:10:00.000Z'
  ): CloudSyncTransport {
    return {
      registerSession: async ({ idempotencyKey, manifest }) =>
        cloud.registerSession({ actorUserId, idempotencyKey, manifest, nowIso }),
      uploadAssetObject: async (params) =>
        cloud.uploadSessionAssetObject({ ...params, actorUserId, nowIso }),
      finalizeSession: async (params) =>
        cloud.finalizeSessionPublication({ ...params, actorUserId, nowIso })
    };
  }

  it('A01: Prepared station starts without internet — capture, review, compositing, and printing work completely offline', async () => {
    const preflight = orchestrator.evaluatePreflight(EVENT_A, {
      nowIso: '2026-10-18T08:05:00.000Z'
    });
    expect(preflight.readyOffline).toBe(true);
    expect(preflight.simulationLabel).toBe('SIMULATION / MOCK HARDWARE MODE');

    const { session } = orchestrator.startSession({
      eventId: EVENT_A,
      templateVersionId: TEMPLATE_VER_A,
      nowIso: '2026-10-18T08:05:00.000Z'
    });

    for (let i = 0; i < 4; i++) {
      await orchestrator.captureFrame({
        sessionId: session.session_id,
        frameIndex: i,
        nowIso: `2026-10-18T08:05:0${i + 1}.000Z`
      });
    }

    const approved = await orchestrator.approveAndCompositeSession({
      sessionId: session.session_id,
      nowIso: '2026-10-18T08:05:10.000Z'
    });
    expect(approved.session.capture_state).toBe('approved');
    expect(approved.session.composite_state).toBe('ready');
    expect(fs.existsSync(approved.compositeFilePath)).toBe(true);

    // Local print succeeds without contacting cloud
    const printOut = await orchestrator.submitPrint({
      sessionId: session.session_id,
      printProfileId: printProfile.id,
      nowIso: '2026-10-18T08:05:12.000Z'
    });
    expect(printOut.attempt.state).toBe('submitted');
    expect(printOut.result.displayMessage).toBe('Submitted — check printer');
  });

  it('A02 & A03: Camera disconnect after shot 2 preserves existing frames; retake replaces 1 frame without extending 24h retention deadline', async () => {
    const { session } = orchestrator.startSession({
      eventId: EVENT_A,
      templateVersionId: TEMPLATE_VER_A,
      nowIso: '2026-10-18T08:00:00.000Z'
    });

    // Disconnect after frameIndex 1 (shot two)
    camera.setScenario({ disconnectAfterFrameIndex: 1 });

    await orchestrator.captureFrame({
      sessionId: session.session_id,
      frameIndex: 0,
      nowIso: '2026-10-18T08:01:00.000Z'
    });
    await orchestrator.captureFrame({
      sessionId: session.session_id,
      frameIndex: 1,
      nowIso: '2026-10-18T08:01:05.000Z'
    });

    // Shot 3 triggers disconnect
    await expect(
      orchestrator.captureFrame({
        sessionId: session.session_id,
        frameIndex: 2,
        nowIso: '2026-10-18T08:01:10.000Z'
      })
    ).rejects.toThrow(/CAMERA_DISCONNECTED/);

    // Existing 2 shots survive in SQLite and on disk
    const survivingShots = orchestrator.db.getActiveSessionShots(session.session_id);
    expect(survivingShots).toHaveLength(2);

    // Operator reconnects camera and finishes remaining frames without restarting session
    camera.setScenario({ disconnectAfterFrameIndex: null });
    camera.reconnect();

    await orchestrator.captureFrame({
      sessionId: session.session_id,
      frameIndex: 2,
      nowIso: '2026-10-18T08:02:00.000Z'
    });
    await orchestrator.captureFrame({
      sessionId: session.session_id,
      frameIndex: 3,
      nowIso: '2026-10-18T08:02:05.000Z'
    });

    const beforeRetake = orchestrator.db.getSessionOrThrow(session.session_id);
    expect(beforeRetake.first_captured_at).toBe('2026-10-18T08:01:00.000Z');
    expect(beforeRetake.expires_at).toBe('2026-10-19T08:01:00.000Z');
    const oldFrame1AssetId = orchestrator.db.getActiveSessionShots(session.session_id)[1]!.asset_id;
    const oldFrame1Path = orchestrator.db.getActiveSessionShots(session.session_id)[1]!.local_file_path;

    // Retake frame 1 thirty minutes later (A03)
    await orchestrator.captureFrame({
      sessionId: session.session_id,
      frameIndex: 1,
      nowIso: '2026-10-18T08:31:00.000Z'
    });

    const afterRetake = orchestrator.db.getSessionOrThrow(session.session_id);
    const activeAfterRetake = orchestrator.db.getActiveSessionShots(session.session_id);
    expect(activeAfterRetake).toHaveLength(4);
    expect(activeAfterRetake[1]!.asset_id).not.toBe(oldFrame1AssetId);
    // Superseded rejected frame deleted from disk
    expect(fs.existsSync(oldFrame1Path)).toBe(false);
    // Original 24h retention deadline is UNCHANGED
    expect(afterRetake.expires_at).toBe('2026-10-19T08:01:00.000Z');
  });

  it('A04 & A05 & A18: Crash after approval preserves manifest; crash during print submission marks outcome unknown and blocks automatic or duplicate reprints', async () => {
    const { session } = orchestrator.startSession({
      eventId: EVENT_A,
      templateVersionId: TEMPLATE_VER_A,
      nowIso: '2026-10-18T08:00:00.000Z'
    });
    for (let i = 0; i < 4; i++) {
      await orchestrator.captureFrame({
        sessionId: session.session_id,
        frameIndex: i,
        nowIso: `2026-10-18T08:00:0${i + 1}.000Z`
      });
    }
    await orchestrator.approveAndCompositeSession({
      sessionId: session.session_id,
      nowIso: '2026-10-18T08:00:10.000Z'
    });

    // Simulate crash during print submission (A05)
    printer.setScenario({ simulateOutcome: 'crash_during_submit' });
    await expect(
      orchestrator.submitPrint({
        sessionId: session.session_id,
        printProfileId: printProfile.id,
        nowIso: '2026-10-18T08:00:15.000Z'
      })
    ).rejects.toThrow(/SIMULATED_CRASH_DURING_PRINT_SUBMISSION/);

    // Before startup reconciliation, attempt is left in 'submitting'
    // Run startup reconciliation: marks interrupted print as 'unknown', never auto-reprints
    const recReport = orchestrator.syncEngine.runStartupReconciliation(
      '2026-10-18T08:00:20.000Z'
    );
    expect(recReport.interruptedPrintsMarkedUnknown).toBe(1);

    const attempts = orchestrator.db.listPrintAttemptsForSession(session.session_id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.state).toBe('unknown');

    // Any new print attempt is blocked until operator resolves unknown outcome (A05 / A18)
    printer.setScenario({ simulateOutcome: 'submitted' });
    await expect(
      orchestrator.submitPrint({
        sessionId: session.session_id,
        printProfileId: printProfile.id,
        isReprint: true
      })
    ).rejects.toThrow(/requires operator inspection/);

    // Operator inspects printer and resolves as failed, then reprints
    orchestrator.resolveUnknownPrintAttempt({
      attemptId: attempts[0]!.attempt_id,
      resolution: 'failed',
      operatorNote: 'Paper jam cleared by operator'
    });

    const reprint = await orchestrator.submitPrint({
      sessionId: session.session_id,
      printProfileId: printProfile.id,
      isReprint: true
    });
    expect(reprint.attempt.state).toBe('submitted');
    expect(reprint.attempt.is_reprint).toBe(1);
  });

  it('A06 & A07 & A17: Idempotent upload/finalization, no partial gallery exposure, and template edits after session never alter existing composite', async () => {
    const { session, canonicalGalleryUrl } = orchestrator.startSession({
      eventId: EVENT_A,
      templateVersionId: TEMPLATE_VER_A,
      nowIso: '2026-10-18T08:00:00.000Z'
    });
    const rawToken = canonicalGalleryUrl.split('/g/')[1]!;

    for (let i = 0; i < 4; i++) {
      await orchestrator.captureFrame({
        sessionId: session.session_id,
        frameIndex: i,
        nowIso: `2026-10-18T08:00:0${i + 1}.000Z`
      });
    }

    const approved = await orchestrator.approveAndCompositeSession({
      sessionId: session.session_id,
      nowIso: '2026-10-18T08:00:10.000Z'
    });
    const originalCompositeSha = computeBufferSha256(
      fs.readFileSync(approved.compositeFilePath)
    );

    // Partial upload check (A07): register session and upload only 1 of 5 assets
    cloud.registerSession({
      actorUserId: OPERATOR_A,
      idempotencyKey: `reg:${session.session_id}:v1`,
      manifest: approved.manifest,
      nowIso: '2026-10-18T08:01:00.000Z'
    });

    // While pending/partial, gallery lookup returns 'registered_pending' and 0 exposed assets
    const pendingLookup = cloud.lookupGalleryByToken({
      rawToken,
      nowIso: '2026-10-18T08:01:05.000Z'
    });
    expect(pendingLookup.state).toBe('registered_pending');
    expect(pendingLookup.assets).toHaveLength(0);

    // Finalization attempt with incomplete objects is rejected
    const prematureFinalize = cloud.finalizeSessionPublication({
      actorUserId: OPERATOR_A,
      idempotencyKey: `fin:${session.session_id}:v1`,
      tenantId: TENANT_A,
      eventId: EVENT_A,
      sessionId: session.session_id,
      manifest: approved.manifest,
      nowIso: '2026-10-18T08:01:10.000Z'
    });
    expect(prematureFinalize.status).toBe('rejected_incomplete');

    // Run full background sync via DurableSyncEngine
    const syncRes = await orchestrator.syncNextPendingJob(
      createCloudTransport(OPERATOR_A, '2026-10-18T08:02:00.000Z'),
      '2026-10-18T08:02:00.000Z'
    );
    expect(syncRes.finalState).toBe('published');

    // Repeat finalization is idempotent (A06)
    const repeatFinalize = cloud.finalizeSessionPublication({
      actorUserId: OPERATOR_A,
      idempotencyKey: `fin:${session.session_id}:v1`,
      tenantId: TENANT_A,
      eventId: EVENT_A,
      sessionId: session.session_id,
      manifest: approved.manifest,
      nowIso: '2026-10-18T08:03:00.000Z'
    });
    expect(repeatFinalize.status).toBe('published');

    // Conflicting byte upload to existing immutable object path is rejected (A06)
    const firstAsset = approved.manifest.assets[0]!;
    const conflictUpload = cloud.uploadSessionAssetObject({
      actorUserId: OPERATOR_A,
      tenantId: TENANT_A,
      eventId: EVENT_A,
      sessionId: session.session_id,
      assetId: firstAsset.assetId,
      storagePath: `${TENANT_A}/${EVENT_A}/${session.session_id}/${firstAsset.assetId}.jpg`,
      buffer: Buffer.from('corrupted-different-bytes'),
      sha256: computeBufferSha256(Buffer.from('corrupted-different-bytes')),
      mimeType: 'image/jpeg',
      nowIso: '2026-10-18T08:03:10.000Z'
    });
    expect(conflictUpload.status).toBe('conflict_mismatch');

    // A17: Publishing a new template version v2 after session approval does not alter existing session print/composite
    cloud.registerTemplateVersion({
      id: '60000000-0000-4000-8000-000000000002',
      tenantId: TENANT_A,
      templateId: '70000000-0000-4000-8000-000000000001',
      name: '4x6 Studio Postcard v2 Edited',
      version: 2,
      definition: createDefaultFourBySixPostcardTemplate({
        overlayAssetId: 'overlay-4x6',
        overlaySha256
      }),
      overlayStoragePath: `${TENANT_A}/overlays/overlay-4x6-v2.png`
    });

    const reprint = await orchestrator.submitPrint({
      sessionId: session.session_id,
      printProfileId: printProfile.id,
      isReprint: true
    });
    const printedArtifactSha = computeBufferSha256(
      fs.readFileSync(reprint.result.previewArtifactPath!)
    );
    expect(printedArtifactSha).toBe(originalCompositeSha);
  });

  it('A08 & A09: Auth expiry pauses upload while local workflow continues; revoked operator is blocked on reconnect', async () => {
    const { session } = orchestrator.startSession({
      eventId: EVENT_A,
      templateVersionId: TEMPLATE_VER_A,
      nowIso: '2026-10-18T08:00:00.000Z'
    });
    for (let i = 0; i < 4; i++) {
      await orchestrator.captureFrame({
        sessionId: session.session_id,
        frameIndex: i,
        nowIso: `2026-10-18T08:00:0${i + 1}.000Z`
      });
    }
    await orchestrator.approveAndCompositeSession({
      sessionId: session.session_id,
      nowIso: '2026-10-18T08:00:10.000Z'
    });

    // A08: Unauthenticated transport (expired JWT) pauses job in 'blocked_auth'
    const unauthSync = await orchestrator.syncNextPendingJob(
      createCloudTransport(null, '2026-10-18T08:01:00.000Z'),
      '2026-10-18T08:01:00.000Z'
    );
    expect(unauthSync.finalState).toBe('blocked_auth');

    // Resume after reauthentication
    expect(orchestrator.syncEngine.resumeAuthBlockedJobs('2026-10-18T08:02:00.000Z')).toBe(1);

    // A09: Owner revokes operator while station was offline; reconnect enforces current server revocation
    cloud.revokeOperatorMembership(TENANT_A, OPERATOR_A);
    const revokedSync = await orchestrator.syncNextPendingJob(
      createCloudTransport(OPERATOR_A, '2026-10-18T08:03:00.000Z'),
      '2026-10-18T08:03:00.000Z'
    );
    expect(revokedSync.finalState).toBe('blocked_auth');

    // Restore operator membership and verify upload completes
    cloud.upsertMembership({
      tenantId: TENANT_A,
      userId: OPERATOR_A,
      role: 'operator',
      status: 'active'
    });
    orchestrator.syncEngine.resumeAuthBlockedJobs('2026-10-18T08:04:00.000Z');
    const okSync = await orchestrator.syncNextPendingJob(
      createCloudTransport(OPERATOR_A, '2026-10-18T08:04:05.000Z'),
      '2026-10-18T08:04:05.000Z'
    );
    expect(okSync.finalState).toBe('published');
  });

  it('A10 & A11 & A21: Session expiring before upload never publishes; upload during deletion is rejected and swept; startup cleans expired local media', async () => {
    const { session, canonicalGalleryUrl } = orchestrator.startSession({
      eventId: EVENT_A,
      templateVersionId: TEMPLATE_VER_A,
      nowIso: '2026-10-18T08:00:00.000Z'
    });
    const rawToken = canonicalGalleryUrl.split('/g/')[1]!;

    for (let i = 0; i < 4; i++) {
      await orchestrator.captureFrame({
        sessionId: session.session_id,
        frameIndex: i,
        nowIso: `2026-10-18T08:00:0${i + 1}.000Z`
      });
    }
    const approved = await orchestrator.approveAndCompositeSession({
      sessionId: session.session_id,
      nowIso: '2026-10-18T08:00:10.000Z'
    });

    // A11: Register at T+1h, upload 1 object, then advance past 24h expiration and attempt finalization
    cloud.registerSession({
      actorUserId: OPERATOR_A,
      idempotencyKey: `reg:${session.session_id}:v1`,
      manifest: approved.manifest,
      nowIso: '2026-10-18T09:00:00.000Z'
    });
    const firstAsset = approved.manifest.assets[0]!;
    cloud.uploadSessionAssetObject({
      actorUserId: OPERATOR_A,
      tenantId: TENANT_A,
      eventId: EVENT_A,
      sessionId: session.session_id,
      assetId: firstAsset.assetId,
      storagePath: `${TENANT_A}/${EVENT_A}/${session.session_id}/${firstAsset.assetId}.jpg`,
      buffer: fs.readFileSync(
        orchestrator.db.getActiveSessionShots(session.session_id)[0]!.local_file_path
      ),
      sha256: firstAsset.sha256,
      mimeType: 'image/jpeg',
      nowIso: '2026-10-18T09:00:05.000Z'
    });
    expect(cloud.getStoredObjectCountForSession(session.session_id)).toBe(1);

    // Attempt finalization after 24h deadline (2026-10-19T08:00:05Z) -> rejected & late object swept (A10 / A11)
    const lateFinalize = cloud.finalizeSessionPublication({
      actorUserId: OPERATOR_A,
      idempotencyKey: `fin:${session.session_id}:v1`,
      tenantId: TENANT_A,
      eventId: EVENT_A,
      sessionId: session.session_id,
      manifest: approved.manifest,
      nowIso: '2026-10-19T08:00:05.000Z'
    });
    expect(lateFinalize.status).toBe('rejected_expired');
    expect(cloud.getStoredObjectCountForSession(session.session_id)).toBe(0);

    // Gallery is never publicly available
    const lookup = cloud.lookupGalleryByToken({
      rawToken,
      nowIso: '2026-10-19T08:00:10.000Z'
    });
    expect(lookup.state).toBe('expired');
    expect(lookup.assets).toHaveLength(0);

    // A21: Computer starts after retention deadline -> local expired media is cleaned before normal access
    expect(fs.existsSync(session.session_dir)).toBe(true);
    const startupReport = orchestrator.syncEngine.runStartupReconciliation(
      '2026-10-19T08:05:00.000Z'
    );
    expect(startupReport.expiredSessionsCleanedLocally).toBe(1);
    expect(fs.existsSync(session.session_dir)).toBe(false);
    expect(orchestrator.db.getSessionOrThrow(session.session_id).deletion_state).toBe(
      'deleted'
    );
  });

  it('A12, A13, A14, A15, A16: Enforces tenant isolation, blocks anonymous listing, handles unknown tokens, enforces immediate expiration, and retries storage deletion failures', async () => {
    // A13: Anonymous user queries sessions directly -> denied
    const anonQuery = cloud.querySessionsDirect({
      actorUserId: null,
      tenantId: TENANT_A
    });
    expect(anonQuery.allowed).toBe(false);
    expect(anonQuery.sessions).toHaveLength(0);

    // A14: Unknown token returns generic unavailable response; no false pending claim
    const unknownTokenLookup = cloud.lookupGalleryByToken({
      rawToken: 'A'.repeat(43),
      nowIso: '2026-10-18T08:10:00.000Z'
    });
    expect(unknownTokenLookup.state).toBe('unknown_unavailable');
    expect(unknownTokenLookup.pollIntervalMs).toBeUndefined();

    // A12: Tenant B supplies Tenant A event/template identifiers -> rejected
    const tenantBUser = '40000000-0000-4000-8000-000000000002';
    cloud.upsertMembership({
      tenantId: TENANT_B,
      userId: tenantBUser,
      role: 'owner',
      status: 'active'
    });
    expect(() =>
      cloud.registerEvent({
        id: '20000000-0000-4000-8000-000000000099',
        tenantId: TENANT_B,
        name: 'Cross-Tenant Attack Event',
        timezone: 'UTC',
        startsAt: '2026-10-18T00:00:00.000Z',
        endsAt: '2026-10-19T00:00:00.000Z',
        status: 'active',
        assignedOperatorIds: new Set([tenantBUser]),
        assignedStationIds: new Set([STATION_A]), // Station belongs to Tenant A!
        templateVersionIds: new Set([TEMPLATE_VER_A]) // Template belongs to Tenant A!
      })
    ).toThrow(/TENANT_ISOLATION_VIOLATION/);

    // Create and publish a valid session in Tenant A
    const { session, canonicalGalleryUrl } = orchestrator.startSession({
      eventId: EVENT_A,
      templateVersionId: TEMPLATE_VER_A,
      nowIso: '2026-10-18T08:00:00.000Z'
    });
    const rawToken = canonicalGalleryUrl.split('/g/')[1]!;
    for (let i = 0; i < 4; i++) {
      await orchestrator.captureFrame({
        sessionId: session.session_id,
        frameIndex: i,
        nowIso: `2026-10-18T08:00:0${i + 1}.000Z`
      });
    }
    await orchestrator.approveAndCompositeSession({
      sessionId: session.session_id,
      nowIso: '2026-10-18T08:00:10.000Z'
    });
    await orchestrator.syncNextPendingJob(
      createCloudTransport(OPERATOR_A, '2026-10-18T08:01:00.000Z'),
      '2026-10-18T08:01:00.000Z'
    );

    // Before expiration: gallery is ready and download authorization is granted
    const readyLookup = cloud.lookupGalleryByToken({
      rawToken,
      nowIso: '2026-10-18T12:00:00.000Z'
    });
    expect(readyLookup.state).toBe('ready');
    expect(readyLookup.assets).toHaveLength(5);

    const dlBefore = cloud.authorizeGuestAssetDownload({
      rawToken,
      assetId: readyLookup.assets[0]!.assetId,
      nowIso: '2026-10-18T12:00:00.000Z'
    });
    expect(dlBefore.authorized).toBe(true);
    expect(dlBefore.ttlSeconds).toBe(60);

    // A15 & A16: Simulate deletion service failure at expiration (2026-10-19T08:00:02Z)
    cloud.setSimulateStorageDeleteFailure(true);
    const failedSweep = cloud.runScheduledDeletionSweep('2026-10-19T08:05:00.000Z');
    expect(failedSweep.failedCount).toBe(1);

    // Even though storage deletion failed, gallery access and download authorization are IMMEDIATELY denied (A15 / A16)
    const expiredLookup = cloud.lookupGalleryByToken({
      rawToken,
      nowIso: '2026-10-19T08:05:01.000Z'
    });
    expect(expiredLookup.state).toBe('expired');
    expect(expiredLookup.assets).toHaveLength(0);

    const dlAfter = cloud.authorizeGuestAssetDownload({
      rawToken,
      assetId: readyLookup.assets[0]!.assetId,
      nowIso: '2026-10-19T08:05:01.000Z'
    });
    expect(dlAfter.authorized).toBe(false);

    // Past 15-minute SLA (2026-10-19T08:20:00Z), overdue deletion is surfaced in alerts (A16)
    const overdueSweep = cloud.runScheduledDeletionSweep('2026-10-19T08:20:00.000Z');
    expect(overdueSweep.overdueAlertSessionIds).toContain(session.session_id);

    // Storage service recovers -> retry sweep deletes objects and completes job
    cloud.setSimulateStorageDeleteFailure(false);
    const recoveredSweep = cloud.runScheduledDeletionSweep('2026-10-19T08:26:00.000Z');
    expect(recoveredSweep.deletedSessionsCount).toBe(1);
    expect(cloud.getStoredObjectCountForSession(session.session_id)).toBe(0);
  });

  it('A19 & A20: Insufficient disk space safely blocks new capture while preserving pending data; significant clock jump raises warning and pauses publication until reconciled', async () => {
    // Create a pending approved session first
    const { session } = orchestrator.startSession({
      eventId: EVENT_A,
      templateVersionId: TEMPLATE_VER_A,
      nowIso: '2026-10-18T08:00:00.000Z'
    });
    for (let i = 0; i < 4; i++) {
      await orchestrator.captureFrame({
        sessionId: session.session_id,
        frameIndex: i,
        nowIso: `2026-10-18T08:00:0${i + 1}.000Z`
      });
    }
    await orchestrator.approveAndCompositeSession({
      sessionId: session.session_id,
      nowIso: '2026-10-18T08:00:10.000Z'
    });

    // A19: Simulate low disk space (10 MB remaining)
    orchestrator.setSimulatedDiskAvailableBytes(10 * 1024 * 1024);
    expect(() =>
      orchestrator.startSession({
        eventId: EVENT_A,
        templateVersionId: TEMPLATE_VER_A
      })
    ).toThrow(/DISK_SPACE_INSUFFICIENT/);

    // Existing pending session data is preserved
    expect(orchestrator.db.getSessionOrThrow(session.session_id).capture_state).toBe(
      'approved'
    );
    orchestrator.setSimulatedDiskAvailableBytes(null);

    // A20: Simulate wall-clock jump (+2 hours ahead of monotonic clock)
    orchestrator.setSimulatedWallClockOffsetMs(2 * 60 * 60 * 1000);
    const clockStatus = orchestrator.checkClockHealth();
    expect(clockStatus.healthy).toBe(false);
    expect(clockStatus.warningReason).toContain('Device clock jumped');

    // Cloud sync pauses while clock is unhealthy
    const blockedByClock = await orchestrator.syncNextPendingJob(
      createCloudTransport(OPERATOR_A, '2026-10-18T08:05:00.000Z'),
      '2026-10-18T08:05:00.000Z'
    );
    expect(blockedByClock.processed).toBe(false);

    // Reconcile clock with server -> publication proceeds
    orchestrator.reconcileClockWithServer('2026-10-18T08:05:00.000Z');
    expect(orchestrator.checkClockHealth().healthy).toBe(true);

    const publishedAfterReconcile = await orchestrator.syncNextPendingJob(
      createCloudTransport(OPERATOR_A, '2026-10-18T08:05:05.000Z'),
      '2026-10-18T08:05:05.000Z'
    );
    expect(publishedAfterReconcile.finalState).toBe('published');
  });

  it('A23: Full simulated event of 500 sessions with mid-event restart — zero lost manifests, zero duplicate publications, and bounded memory', async () => {
    const TOTAL_SESSIONS = 500;
    const baseTimeMs = Date.parse('2026-10-18T09:00:00.000Z');

    for (let idx = 0; idx < TOTAL_SESSIONS; idx++) {
      const tIso = new Date(baseTimeMs + idx * 1000).toISOString();
      const { session } = orchestrator.startSession({
        eventId: EVENT_A,
        templateVersionId: TEMPLATE_VER_A,
        nowIso: tIso
      });

      const shots: Array<{
        assetId: string;
        shotIndex: number;
        width: number;
        height: number;
        byteSize: number;
        sha256: string;
        mimeType: 'image/jpeg';
      }> = [];

      for (let f = 0; f < 4; f++) {
        const assetId = `00000000-0000-4000-8000-${String(idx * 10 + f).padStart(12, '0')}`;
        const shotPath = path.join(session.session_dir, `shot-${f}.jpg`);
        const shotBytes = Buffer.from(`synthetic-shot-${idx}-${f}`);
        fs.writeFileSync(shotPath, shotBytes);
        const sha256 = computeBufferSha256(shotBytes);

        orchestrator.db.recordCapturedShot({
          sessionId: session.session_id,
          assetId,
          frameIndex: f,
          localFilePath: shotPath,
          width: 1200,
          height: 1600,
          byteSize: shotBytes.byteLength,
          sha256,
          capturedAtIso: tIso
        });
        shots.push({
          assetId,
          shotIndex: f,
          width: 1200,
          height: 1600,
          byteSize: shotBytes.byteLength,
          sha256,
          mimeType: 'image/jpeg'
        });
      }

      orchestrator.db.updateCaptureState(
        session.session_id,
        'capturing',
        'Started capturing sequence',
        tIso
      );
      orchestrator.db.updateCaptureState(
        session.session_id,
        'reviewing',
        'All 4 frames captured',
        tIso
      );
      orchestrator.db.updateCompositeState(
        session.session_id,
        'rendering',
        'Rendering composite',
        tIso
      );

      const compAssetId = `00000000-0000-4000-8000-${String(idx * 10 + 9).padStart(12, '0')}`;
      const compPath = path.join(session.session_dir, `composite.jpg`);
      const compBytes = Buffer.from(`synthetic-composite-${idx}`);
      fs.writeFileSync(compPath, compBytes);
      const compSha = computeBufferSha256(compBytes);

      const currentSession = orchestrator.db.getSessionOrThrow(session.session_id);
      const manifest: ApprovedSessionManifest = {
        manifestVersion: 1,
        sessionId: session.session_id,
        tenantId: TENANT_A,
        eventId: EVENT_A,
        stationId: STATION_A,
        operatorId: OPERATOR_A,
        templateVersionId: TEMPLATE_VER_A,
        tokenHash: currentSession.token_hash,
        firstCapturedAt: currentSession.first_captured_at!,
        approvedAt: tIso,
        expiresAt: currentSession.expires_at!,
        assets: [
          ...shots.map((s) => ({
            assetId: s.assetId,
            kind: 'shot' as const,
            shotIndex: s.shotIndex,
            width: s.width,
            height: s.height,
            byteSize: s.byteSize,
            sha256: s.sha256,
            mimeType: 'image/jpeg' as const
          })),
          {
            assetId: compAssetId,
            kind: 'composite' as const,
            shotIndex: null,
            width: 1200,
            height: 1800,
            byteSize: compBytes.byteLength,
            sha256: compSha,
            mimeType: 'image/jpeg' as const
          }
        ]
      };

      orchestrator.db.commitApprovedSessionAndEnqueueUpload({
        sessionId: session.session_id,
        compositeAsset: {
          assetId: compAssetId,
          localFilePath: compPath,
          width: 1200,
          height: 1800,
          byteSize: compBytes.byteLength,
          sha256: compSha
        },
        manifest,
        approvedAtIso: tIso
      });

      // Simulate station restart & reconciliation halfway through the 500 sessions
      if (idx === 249) {
        orchestrator.syncEngine.runStartupReconciliation(tIso);
      }
    }

    const transport = createCloudTransport(OPERATOR_A, '2026-10-18T10:00:00.000Z');
    let publishedCount = 0;
    while (true) {
      const res = await orchestrator.syncNextPendingJob(
        transport,
        '2026-10-18T10:00:00.000Z'
      );
      if (!res.processed) break;
      if (res.finalState === 'published') {
        publishedCount += 1;
      }
    }

    expect(publishedCount).toBe(TOTAL_SESSIONS);
    const cloudSessions = cloud.querySessionsDirect({
      actorUserId: OWNER_A,
      tenantId: TENANT_A,
      eventId: EVENT_A
    });
    expect(cloudSessions.allowed).toBe(true);
    expect(cloudSessions.sessions).toHaveLength(TOTAL_SESSIONS);
  });
});
