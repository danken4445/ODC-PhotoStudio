import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  generateEd25519GrantKeyPair,
  signOfflineGrant,
  type PrintProfile,
  type SignedOfflineGrant
} from '@odc-photostudio/contracts';
import { createDefaultFourBySixPostcardTemplate } from '@odc-photostudio/template-engine';
import { StationDatabase } from '../src/main/db.js';
import { StationOrchestrator, type CachedEventConfiguration } from '../src/main/orchestrator.js';
import { MockCameraProvider } from '../src/main/camera/provider.js';
import { MockPrinterProvider } from '../src/main/printer/provider.js';

describe('Stream D: Station Enrollment & Local Plan Limits', () => {
  let tempDir: string;
  let db: StationDatabase;
  const stationId = '30000000-0000-4000-8000-000000000001';
  const tenantId = '10000000-0000-4000-8000-000000000001';
  const eventId = '20000000-0000-4000-8000-000000000001';
  const operatorId = '40000000-0000-4000-8000-000000000001';
  const templateVersionId = '60000000-0000-4000-8000-000000000001';

  let grantKeys: { publicKeyPem: string; privateKeyPem: string };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odc-station-test-'));
    db = new StationDatabase(tempDir, stationId);
    grantKeys = generateEd25519GrantKeyPair();
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.restoreAllMocks();
  });

  function createTestSession(customSessionId: string, createdAtIso: string) {
    const sessionDir = path.join(tempDir, 'sessions', customSessionId);
    fs.mkdirSync(sessionDir, { recursive: true });

    const sess = db.createSession({
      sessionId: customSessionId,
      tenantId,
      eventId,
      stationId,
      operatorId,
      templateVersionId,
      galleryTokenProtected: Buffer.from('token-dummy-12345678901234567890123456789012345').toString('base64'),
      tokenHash: 'hash-' + customSessionId,
      sessionDir,
      nowIso: createdAtIso
    });

    // Mark as approved & composite ready so print attempts can be created
    db.db
      .prepare(
        `UPDATE sessions
         SET capture_state = 'approved', composite_state = 'ready', first_captured_at = ?, approved_at = ?, expires_at = ?
         WHERE session_id = ?`
      )
      .run(createdAtIso, createdAtIso, new Date(Date.parse(createdAtIso) + 86400000).toISOString(), customSessionId);

    return sess;
  }

  function setupEventPackage(options: {
    maxTransactionsPerDay?: number | null;
    softCopyQr?: boolean;
    plan?: 'basic' | 'plus' | 'business';
  } = {}) {
    const overlayDir = path.join(tempDir, 'overlays');
    fs.mkdirSync(overlayDir, { recursive: true });
    const overlayPath = path.join(overlayDir, `${templateVersionId}.png`);

    // Create 1200x1800 transparent PNG
    const overlayBuffer = sharp({
      create: {
        width: 1200,
        height: 1800,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .png()
      .toBuffer();

    return overlayBuffer.then((buf) => {
      fs.writeFileSync(overlayPath, buf);
      const overlaySha256 = db.db.prepare('SELECT 1').get() ? require('node:crypto').createHash('sha256').update(buf).digest('hex') : '';

      const tplDef = createDefaultFourBySixPostcardTemplate({
        overlayAssetId: 'overlay-1',
        overlaySha256
      });

      const printProfile: PrintProfile = {
        id: 'prof-4x6',
        name: 'Standard 4x6',
        deviceName: 'Mock Printer',
        paperSize: '4x6_postcard',
        dpi: 300,
        scalingMode: 'exact_1_to_1',
        maxCopiesPerSession: 4,
        offsetXMm: 0,
        offsetYMm: 0,
        supportsTwoBySixCut: false,
        stripImposition: 'none'
      };

      const eventConfig: CachedEventConfiguration = {
        eventId,
        tenantId,
        stationId,
        operatorId,
        eventName: 'Test PhotoStudio Event',
        galleryOrigin: 'https://gallery.odc-photostudio.example.com',
        templates: [
          {
            templateVersionId,
            name: '4x6 Postcard',
            version: 1,
            definition: tplDef,
            overlayFilePath: overlayPath
          }
        ],
        printProfiles: [printProfile]
      };

      const grant: SignedOfflineGrant = signOfflineGrant(
        {
          grantId: '50000000-0000-4000-8000-000000000001',
          tenantId,
          eventId,
          stationId,
          operatorId,
          role: 'operator',
          permittedTemplateVersionIds: [templateVersionId],
          permittedPrintProfileIds: ['prof-4x6'],
          galleryOrigin: eventConfig.galleryOrigin,
          issuedAt: '2026-10-19T00:00:00.000Z',
          expiresAt: '2026-10-21T00:00:00.000Z',
          plan: options.plan ?? 'plus',
          maxTransactionsPerDay: options.maxTransactionsPerDay ?? 100,
          softCopyQr: options.softCopyQr ?? true,
          maxCustomLayouts: 3
        },
        grantKeys.privateKeyPem
      );

      return { eventConfig, grant, overlayPath };
    });
  }

  describe('Task 1: countCompletedTransactionsToday & Station Config Storage', () => {
    it('accurately counts completed transactions and ignores reprints and cancelled/failed prints', () => {
      const today = '2026-10-19T10:00:00.000Z';
      const yesterday = '2026-10-18T15:00:00.000Z';

      // 1. Session A: completed print today -> should count (+1)
      createTestSession('11111111-0000-4000-8000-000000000001', today);
      const att1 = db.createPrintAttempt({
        sessionId: '11111111-0000-4000-8000-000000000001',
        printProfileId: 'prof-4x6',
        copies: 1,
        isReprint: false,
        nowIso: today
      });
      db.transitionPrintAttempt({ attemptId: att1.attempt_id, toState: 'submitting', nowIso: today });
      db.transitionPrintAttempt({ attemptId: att1.attempt_id, toState: 'submitted', nowIso: today });

      // 2. Session B: completed print today with 'confirmed' state -> should count (+1)
      createTestSession('22222222-0000-4000-8000-000000000001', today);
      const att2 = db.createPrintAttempt({
        sessionId: '22222222-0000-4000-8000-000000000001',
        printProfileId: 'prof-4x6',
        copies: 1,
        isReprint: false,
        nowIso: today
      });
      db.transitionPrintAttempt({ attemptId: att2.attempt_id, toState: 'submitting', nowIso: today });
      db.transitionPrintAttempt({ attemptId: att2.attempt_id, toState: 'confirmed', nowIso: today });

      // 3. Reprint of Session B today -> reprint should NOT count
      const att2Reprint = db.createPrintAttempt({
        sessionId: '22222222-0000-4000-8000-000000000001',
        printProfileId: 'prof-4x6',
        copies: 1,
        isReprint: true,
        nowIso: today
      });
      db.transitionPrintAttempt({ attemptId: att2Reprint.attempt_id, toState: 'submitting', nowIso: today });
      db.transitionPrintAttempt({ attemptId: att2Reprint.attempt_id, toState: 'confirmed', nowIso: today });

      // 4. Session C: failed print today -> should NOT count
      createTestSession('33333333-0000-4000-8000-000000000001', today);
      const att3 = db.createPrintAttempt({
        sessionId: '33333333-0000-4000-8000-000000000001',
        printProfileId: 'prof-4x6',
        copies: 1,
        isReprint: false,
        nowIso: today
      });
      db.transitionPrintAttempt({ attemptId: att3.attempt_id, toState: 'failed', nowIso: today });

      // 5. Session D: cancelled print today -> should NOT count
      createTestSession('44444444-0000-4000-8000-000000000001', today);
      const att4 = db.createPrintAttempt({
        sessionId: '44444444-0000-4000-8000-000000000001',
        printProfileId: 'prof-4x6',
        copies: 1,
        isReprint: false,
        nowIso: today
      });
      db.transitionPrintAttempt({ attemptId: att4.attempt_id, toState: 'cancelled', nowIso: today });

      // 6. Session E: completed print yesterday -> should NOT count for today
      createTestSession('55555555-0000-4000-8000-000000000001', yesterday);
      const att5 = db.createPrintAttempt({
        sessionId: '55555555-0000-4000-8000-000000000001',
        printProfileId: 'prof-4x6',
        copies: 1,
        isReprint: false,
        nowIso: yesterday
      });
      db.transitionPrintAttempt({ attemptId: att5.attempt_id, toState: 'submitting', nowIso: yesterday });
      db.transitionPrintAttempt({ attemptId: att5.attempt_id, toState: 'confirmed', nowIso: yesterday });

      const countToday = db.countCompletedTransactionsToday(today);
      expect(countToday).toBe(2);

      const countYesterday = db.countCompletedTransactionsToday(yesterday);
      expect(countYesterday).toBe(1);
    });

    it('stores and retrieves station configuration', () => {
      db.setStationConfig('station_id', 'new-station-id-999');
      db.setStationConfig('tenant_id', 'new-tenant-id-888');
      db.setStationConfig('plan', 'plus');
      db.setStationConfig('server_url', 'http://192.168.1.50:3000');

      expect(db.getStationConfig('station_id')).toBe('new-station-id-999');
      expect(db.getStationConfig('tenant_id')).toBe('new-tenant-id-888');
      expect(db.getStationConfig('plan')).toBe('plus');
      expect(db.getStationConfig('server_url')).toBe('http://192.168.1.50:3000');

      const map = db.getStationConfigMap();
      expect(map.station_id).toBe('new-station-id-999');
      expect(map.plan).toBe('plus');
    });
  });

  describe('Task 2: Orchestrator Plan Limit Enforcement & Enrollment', () => {
    it('startSession enforces maxTransactionsPerDay and throws PLAN_LIMIT_EXCEEDED when cap is reached', async () => {
      const orchestrator = new StationOrchestrator({
        dataDir: tempDir,
        stationId,
        camera: new MockCameraProvider((id) => path.join(tempDir, 'sessions', id)),
        printer: new MockPrinterProvider(path.join(tempDir, 'prints')),
        grantPublicKeyPem: grantKeys.publicKeyPem
      });

      const { eventConfig, grant } = await setupEventPackage({ maxTransactionsPerDay: 2 });
      orchestrator.prepareEventOffline({
        config: eventConfig,
        grant,
        serverTimeIso: '2026-10-19T10:00:00.000Z',
        nowIso: '2026-10-19T10:00:00.000Z'
      });

      // Seed 2 completed transactions today
      const today = '2026-10-19T11:00:00.000Z';
      for (let i = 1; i <= 2; i++) {
        const sId = `90000000-0000-4000-8000-00000000000${i}`;
        createTestSession(sId, today);
        const att = orchestrator.db.createPrintAttempt({
          sessionId: sId,
          printProfileId: 'prof-4x6',
          copies: 1,
          isReprint: false,
          nowIso: today
        });
        orchestrator.db.transitionPrintAttempt({
          attemptId: att.attempt_id,
          toState: 'submitting',
          nowIso: today
        });
        orchestrator.db.transitionPrintAttempt({
          attemptId: att.attempt_id,
          toState: 'submitted',
          nowIso: today
        });
      }

      expect(orchestrator.db.countCompletedTransactionsToday(today)).toBe(2);

      // Now startSession must be rejected with PLAN_LIMIT_EXCEEDED
      expect(() =>
        orchestrator.startSession({
          eventId,
          templateVersionId,
          nowIso: today
        })
      ).toThrow('PLAN_LIMIT_EXCEEDED: Daily transaction limit exceeded for this plan. New sessions are blocked.');

      orchestrator.close();
    });

    it('allows an in-progress session to complete even when cap is reached', async () => {
      const camera = new MockCameraProvider((id) => path.join(tempDir, 'sessions', id));
      await camera.initialize();

      const orchestrator = new StationOrchestrator({
        dataDir: tempDir,
        stationId,
        camera,
        printer: new MockPrinterProvider(path.join(tempDir, 'prints')),
        grantPublicKeyPem: grantKeys.publicKeyPem
      });

      const { eventConfig, grant } = await setupEventPackage({ maxTransactionsPerDay: 1 });
      orchestrator.prepareEventOffline({
        config: eventConfig,
        grant,
        serverTimeIso: '2026-10-19T10:00:00.000Z',
        nowIso: '2026-10-19T10:00:00.000Z'
      });

      const today = '2026-10-19T11:00:00.000Z';

      // Start Session 1 when count is 0 (allowed)
      const { session } = orchestrator.startSession({
        eventId,
        templateVersionId,
        nowIso: today
      });
      expect(session.session_id).toBeDefined();

      // Capture all 4 frames
      for (let f = 0; f < 4; f++) {
        await orchestrator.captureFrame({
          sessionId: session.session_id,
          frameIndex: f,
          nowIso: today
        });
      }

      // Approve & Composite Session 1
      const { manifest } = await orchestrator.approveAndCompositeSession({
        sessionId: session.session_id,
        nowIso: today
      });
      expect(manifest.sessionId).toBe(session.session_id);

      // Submit Print for Session 1 -> now count becomes 1 (cap reached)
      const { attempt } = await orchestrator.submitPrint({
        sessionId: session.session_id,
        printProfileId: 'prof-4x6',
        copies: 1,
        nowIso: today
      });
      expect(attempt.state).toBe('submitted');
      expect(orchestrator.db.countCompletedTransactionsToday(today)).toBe(1);

      // Reprint of Session 1 is allowed even though cap is reached
      const reprintRes = await orchestrator.submitPrint({
        sessionId: session.session_id,
        printProfileId: 'prof-4x6',
        copies: 1,
        isReprint: true,
        nowIso: today
      });
      expect(reprintRes.attempt.is_reprint).toBe(1);

      // Starting a new session now fails
      expect(() =>
        orchestrator.startSession({
          eventId,
          templateVersionId,
          nowIso: today
        })
      ).toThrow(/PLAN_LIMIT_EXCEEDED/);

      orchestrator.close();
    });

    it('softCopyQr: false suppresses QR embedding and cloud upload enqueue', async () => {
      const camera = new MockCameraProvider((id) => path.join(tempDir, 'sessions', id));
      await camera.initialize();

      const orchestrator = new StationOrchestrator({
        dataDir: tempDir,
        stationId,
        camera,
        printer: new MockPrinterProvider(path.join(tempDir, 'prints')),
        grantPublicKeyPem: grantKeys.publicKeyPem
      });

      const { eventConfig, grant } = await setupEventPackage({
        softCopyQr: false,
        plan: 'basic'
      });
      orchestrator.prepareEventOffline({
        config: eventConfig,
        grant,
        serverTimeIso: '2026-10-19T10:00:00.000Z',
        nowIso: '2026-10-19T10:00:00.000Z'
      });

      const today = '2026-10-19T11:00:00.000Z';
      const { session } = orchestrator.startSession({
        eventId,
        templateVersionId,
        nowIso: today
      });

      for (let f = 0; f < 4; f++) {
        await orchestrator.captureFrame({
          sessionId: session.session_id,
          frameIndex: f,
          nowIso: today
        });
      }

      const { compositeFilePath } = await orchestrator.approveAndCompositeSession({
        sessionId: session.session_id,
        nowIso: today
      });

      expect(fs.existsSync(compositeFilePath)).toBe(true);

      // Verify that NO upload job was enqueued in durable_jobs
      const durableJobs = orchestrator.db.db
        .prepare(`SELECT * FROM durable_jobs WHERE session_id = ?`)
        .all(session.session_id);
      expect(durableJobs.length).toBe(0);

      orchestrator.close();
    });

    it('enrollStationWithCode makes POST request, persists config, and returns activation data', async () => {
      const orchestrator = new StationOrchestrator({
        dataDir: tempDir,
        stationId,
        camera: new MockCameraProvider((id) => path.join(tempDir, 'sessions', id)),
        printer: new MockPrinterProvider(path.join(tempDir, 'prints')),
        grantPublicKeyPem: grantKeys.publicKeyPem
      });

      const mockEnrollResponse = {
        tenantId: 'tenant-activated-123',
        stationId: 'station-activated-456',
        status: 'active',
        plan: 'plus'
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockEnrollResponse
      });
      globalThis.fetch = mockFetch;

      const result = await orchestrator.enrollStationWithCode({
        serverUrl: 'http://localhost:3000',
        code: 'ODC-ST-XYZ123',
        deviceLabel: 'Main Booth PC'
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe('http://localhost:3000/api/v1/station/enroll');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({
        code: 'ODC-ST-XYZ123',
        deviceLabel: 'Main Booth PC'
      });

      expect(result).toEqual(mockEnrollResponse);

      // Verify persistence in local SQLite
      expect(orchestrator.db.getStationConfig('station_id')).toBe('station-activated-456');
      expect(orchestrator.db.getStationConfig('tenant_id')).toBe('tenant-activated-123');
      expect(orchestrator.db.getStationConfig('plan')).toBe('plus');
      expect(orchestrator.db.getStationConfig('server_url')).toBe('http://localhost:3000');

      orchestrator.close();
    });
  });
});
