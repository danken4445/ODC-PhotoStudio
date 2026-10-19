import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import {
  computeBufferSha256,
  generateGalleryToken,
  hashGalleryToken,
  type ApprovedSessionManifest,
  type PrintProfile
} from '@odc-photostudio/contracts';
import { SupabaseCloudPortalRepository } from '../src/lib/supabase-repository';
import { POST as prepareGrantHandler } from '../src/app/api/v1/station/prepare-grant/route';
import { POST as registerSessionHandler } from '../src/app/api/v1/sessions/register/route';
import { PUT as uploadAssetHandler } from '../src/app/api/v1/sessions/[sessionId]/assets/[assetId]/route';
import { POST as finalizeSessionHandler } from '../src/app/api/v1/sessions/[sessionId]/finalize/route';
import { GET as galleryLookupHandler } from '../src/app/api/v1/gallery/[token]/route';
import { GET as galleryDownloadHandler } from '../src/app/api/v1/gallery/[token]/download/route';
import { POST as deletionSweepHandler } from '../src/app/api/v1/internal/cron/deletion-sweep/route';

const TENANT_ID = '10000000-0000-4000-8000-000000000001';
const EVENT_ID = '20000000-0000-4000-8000-000000000001';
const STATION_ID = '30000000-0000-4000-8000-000000000001';
const OPERATOR_ID = '40000000-0000-4000-8000-000000000001';
const TEMPLATE_VER_ID = '60000000-0000-4000-8000-000000000001';

describe('Phase 2B: Supabase Repository & Next.js API Routes', () => {
  const printProfile: PrintProfile = {
    id: 'prof-4x6-standard',
    name: '4x6 Postcard Standard',
    deviceName: 'DNP-DS620A',
    paperSize: '4x6_postcard',
    dpi: 300,
    scalingMode: 'exact_1_to_1',
    offsetXMm: 0,
    offsetYMm: 0,
    maxCopiesPerSession: 3,
    supportsTwoBySixCut: false,
    stripImposition: 'none'
  };

  it('SupabaseCloudPortalRepository handles lifecycle methods in in-memory / fallback mode', async () => {
    const repo = new SupabaseCloudPortalRepository();
    const fallback = repo.getFallbackService();

    fallback.registerTenant({ id: TENANT_ID, name: 'Studio Alpha', slug: 'studio-alpha' });
    fallback.upsertMembership({
      tenantId: TENANT_ID,
      userId: OPERATOR_ID,
      role: 'operator',
      status: 'active'
    });
    fallback.registerStation({
      id: STATION_ID,
      tenantId: TENANT_ID,
      label: 'Station Alpha-1',
      status: 'active'
    });
    fallback.registerTemplateVersion({
      id: TEMPLATE_VER_ID,
      tenantId: TENANT_ID,
      templateId: '70000000-0000-4000-8000-000000000001',
      name: 'Default 4x6',
      version: 1,
      definition: {} as any,
      overlayStoragePath: 'overlay.png'
    });
    fallback.registerEvent({
      id: EVENT_ID,
      tenantId: TENANT_ID,
      name: 'Grand Gala 2026',
      timezone: 'Asia/Manila',
      startsAt: '2026-10-18T00:00:00Z',
      endsAt: '2026-10-20T00:00:00Z',
      status: 'active',
      assignedOperatorIds: new Set([OPERATOR_ID]),
      assignedStationIds: new Set([STATION_ID]),
      templateVersionIds: new Set([TEMPLATE_VER_ID])
    });

    // 1. Issue offline grant
    const grant = await repo.issueOfflineEventGrant({
      actorUserId: OPERATOR_ID,
      tenantId: TENANT_ID,
      eventId: EVENT_ID,
      stationId: STATION_ID,
      permittedPrintProfiles: [printProfile],
      nowIso: '2026-10-18T08:00:00Z'
    });
    expect(grant.signatureBase64Url).toBeDefined();
    expect(grant.payload.stationId).toBe(STATION_ID);

    // 2. Register session
    const sessionId = crypto.randomUUID();
    const rawToken = generateGalleryToken();
    const tokenHash = hashGalleryToken(rawToken);
    const capturedAt = '2026-10-18T08:00:00.000Z';
    const expiresAt = '2026-10-19T08:00:00.000Z';

    const testAsset = {
      assetId: crypto.randomUUID(),
      kind: 'composite' as const,
      shotIndex: null,
      width: 1200,
      height: 1800,
      byteSize: 12,
      sha256: computeBufferSha256(Buffer.from('sample-asset')),
      mimeType: 'image/jpeg' as const
    };

    const manifest: ApprovedSessionManifest = {
      manifestVersion: 1,
      sessionId,
      tenantId: TENANT_ID,
      eventId: EVENT_ID,
      stationId: STATION_ID,
      operatorId: OPERATOR_ID,
      templateVersionId: TEMPLATE_VER_ID,
      tokenHash,
      firstCapturedAt: capturedAt,
      approvedAt: '2026-10-18T08:00:10.000Z',
      expiresAt,
      assets: [
        testAsset,
        {
          assetId: crypto.randomUUID(),
          kind: 'shot',
          shotIndex: 0,
          width: 1200,
          height: 800,
          byteSize: 12,
          sha256: computeBufferSha256(Buffer.from('sample-asset')),
          mimeType: 'image/jpeg'
        }
      ]
    };

    const reg = await repo.registerSession({
      actorUserId: OPERATOR_ID,
      idempotencyKey: `idemp-${sessionId}`,
      manifest,
      nowIso: '2026-10-18T08:00:20Z'
    });
    expect(reg.status).toBe('ok');

    // 3. Upload session asset
    const uploadRes = await repo.uploadSessionAssetObject({
      actorUserId: OPERATOR_ID,
      tenantId: TENANT_ID,
      eventId: EVENT_ID,
      sessionId,
      assetId: testAsset.assetId,
      storagePath: `${TENANT_ID}/${EVENT_ID}/${sessionId}/${testAsset.assetId}.jpg`,
      buffer: Buffer.from('sample-asset'),
      sha256: testAsset.sha256,
      mimeType: 'image/jpeg',
      nowIso: '2026-10-18T08:00:30Z'
    });
    expect(uploadRes.status).toBe('ok');

    // Repeat upload with same bytes is idempotent
    const repeatUpload = await repo.uploadSessionAssetObject({
      actorUserId: OPERATOR_ID,
      tenantId: TENANT_ID,
      eventId: EVENT_ID,
      sessionId,
      assetId: testAsset.assetId,
      storagePath: `${TENANT_ID}/${EVENT_ID}/${sessionId}/${testAsset.assetId}.jpg`,
      buffer: Buffer.from('sample-asset'),
      sha256: testAsset.sha256,
      mimeType: 'image/jpeg',
      nowIso: '2026-10-18T08:00:35Z'
    });
    expect(repeatUpload.status).toBe('ok');

    // 4. Lookup gallery while pending
    const pendingLookup = await repo.lookupGalleryByToken({
      rawToken,
      nowIso: '2026-10-18T08:00:40Z'
    });
    expect(pendingLookup.state).toBe('registered_pending');

    // 5. Scheduled deletion sweep and early deletion
    const sweep = await repo.runScheduledDeletionSweep('2026-10-18T08:00:45Z');
    expect(sweep.failedCount).toBe(0);

    fallback.upsertMembership({
      tenantId: TENANT_ID,
      userId: OPERATOR_ID,
      role: 'owner',
      status: 'active'
    });
    const earlyDel = await repo.requestEarlyDeletion({
      actorUserId: OPERATOR_ID,
      tenantId: TENANT_ID,
      sessionId,
      nowIso: '2026-10-18T08:00:50Z'
    });
    expect(earlyDel.deleted).toBe(true);
  });

  it('POST /api/v1/station/prepare-grant route validates request and responds', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/station/prepare-grant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-actor-user-id': OPERATOR_ID
      },
      body: JSON.stringify({
        apiVersion: 'v1',
        tenantId: TENANT_ID,
        eventId: EVENT_ID,
        stationId: STATION_ID,
        deviceLabel: 'Alpha Station'
      })
    });

    const res = await prepareGrantHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.apiVersion).toBe('v1');
    expect(data.offlineGrant).toBeDefined();
    expect(data.serverTimeIso).toBeDefined();
  });

  it('GET /api/v1/gallery/[token] returns unknown_unavailable for invalid token without leaking claims', async () => {
    const unknownToken = 'B'.repeat(43);
    const req = new NextRequest(`http://localhost:3000/api/v1/gallery/${unknownToken}`);

    const res = await galleryLookupHandler(req, {
      params: Promise.resolve({ token: unknownToken })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe('unknown_unavailable');
    expect(data.assets).toEqual([]);
  });

  it('GET /api/v1/gallery/[token]/download rejects when assetId is missing', async () => {
    const token = 'C'.repeat(43);
    const req = new NextRequest(`http://localhost:3000/api/v1/gallery/${token}/download`);

    const res = await galleryDownloadHandler(req, {
      params: Promise.resolve({ token })
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/v1/internal/cron/deletion-sweep triggers deletion sweep', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/internal/cron/deletion-sweep', {
      method: 'POST',
      headers: {
        authorization: 'Bearer replace-with-cron-worker-bearer-secret'
      }
    });

    const res = await deletionSweepHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.apiVersion).toBe('v1');
    expect(data.result).toBeDefined();
  });
});
