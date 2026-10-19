import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ApprovedSessionManifest } from '@odc-photostudio/contracts';
import { HttpCloudSyncTransport } from '../src/main/queue/http-transport.js';

describe('Phase 4: Operator Desktop End-to-End Wiring', () => {
  const sampleManifest: ApprovedSessionManifest = {
    manifestVersion: 1,
    sessionId: '55000000-0000-4000-8000-000000000001',
    tenantId: '10000000-0000-4000-8000-000000000001',
    eventId: '20000000-0000-4000-8000-000000000001',
    stationId: '30000000-0000-4000-8000-000000000001',
    operatorId: '40000000-0000-4000-8000-000000000001',
    templateVersionId: '60000000-0000-4000-8000-000000000001',
    tokenHash: 'a'.repeat(64),
    firstCapturedAt: '2026-10-19T08:00:00.000Z',
    approvedAt: '2026-10-19T08:02:00.000Z',
    expiresAt: '2026-10-20T08:00:00.000Z',
    assets: [
      {
        assetId: '77000000-0000-4000-8000-000000000001',
        kind: 'shot',
        shotIndex: 0,
        width: 1200,
        height: 1600,
        byteSize: 1000,
        sha256: 'b'.repeat(64),
        mimeType: 'image/jpeg'
      },
      {
        assetId: '77000000-0000-4000-8000-000000000002',
        kind: 'composite',
        shotIndex: null,
        width: 1200,
        height: 1800,
        byteSize: 2000,
        sha256: 'c'.repeat(64),
        mimeType: 'image/jpeg'
      }
    ]
  };

  describe('HttpCloudSyncTransport', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it('registerSession sends correct POST payload and extracts alreadyUploadedAssetIds', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({
          apiVersion: 'v1',
          sessionId: sampleManifest.sessionId,
          uploadState: 'registering',
          objectTargets: [
            { assetId: '77000000-0000-4000-8000-000000000001', storagePath: '...', alreadyUploaded: true },
            { assetId: '77000000-0000-4000-8000-000000000002', storagePath: '...', alreadyUploaded: false }
          ]
        })
      });
      globalThis.fetch = mockFetch;

      const transport = new HttpCloudSyncTransport({
        baseUrl: 'http://test-portal:4000/',
        getBearerToken: () => 'SECRET_BEARER_TOKEN_123'
      });

      const res = await transport.registerSession({
        idempotencyKey: 'idemp-test-register-12345',
        manifest: sampleManifest
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe('http://test-portal:4000/api/v1/sessions/register');
      expect(init.method).toBe('POST');
      expect(init.headers['Authorization']).toBe('Bearer SECRET_BEARER_TOKEN_123');
      expect(init.headers['Idempotency-Key']).toBe('idemp-test-register-12345');

      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody.idempotencyKey).toBe('idemp-test-register-12345');
      expect(parsedBody.manifest.sessionId).toBe(sampleManifest.sessionId);

      expect(res.status).toBe('ok');
      expect(res.alreadyUploadedAssetIds).toEqual(['77000000-0000-4000-8000-000000000001']);
    });

    it('uploadAssetObject sends PUT with scoped metadata headers and binary payload', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({ success: true })
      });
      globalThis.fetch = mockFetch;

      const transport = new HttpCloudSyncTransport({
        baseUrl: 'http://test-portal:4000',
        getBearerToken: () => 'TOKEN_XYZ'
      });

      const buffer = Buffer.from('test-image-bytes');
      const res = await transport.uploadAssetObject({
        tenantId: sampleManifest.tenantId,
        eventId: sampleManifest.eventId,
        sessionId: sampleManifest.sessionId,
        assetId: sampleManifest.assets[0]!.assetId,
        storagePath: 'ten/ev/sess/asset.jpg',
        buffer,
        sha256: sampleManifest.assets[0]!.sha256,
        mimeType: 'image/jpeg'
      });

      expect(res.status).toBe('ok');
      const [url, init] = mockFetch.mock.calls[0]!;
      expect(url).toBe(
        `http://test-portal:4000/api/v1/sessions/${sampleManifest.sessionId}/assets/${sampleManifest.assets[0]!.assetId}`
      );
      expect(init.method).toBe('PUT');
      expect(init.headers['Content-Type']).toBe('image/jpeg');
      expect(init.headers['x-sha256']).toBe(sampleManifest.assets[0]!.sha256);
      expect(init.headers['x-tenant-id']).toBe(sampleManifest.tenantId);
      expect(init.headers['x-storage-path']).toBe('ten/ev/sess/asset.jpg');
    });

    it('finalizeSession sends POST and handles published response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({
          apiVersion: 'v1',
          sessionId: sampleManifest.sessionId,
          published: true,
          publishedAt: '2026-10-19T08:05:00.000Z',
          uploadState: 'published'
        })
      });
      globalThis.fetch = mockFetch;

      const transport = new HttpCloudSyncTransport({
        baseUrl: 'http://test-portal:4000'
      });

      const res = await transport.finalizeSession({
        idempotencyKey: 'idemp-finalize-12345',
        tenantId: sampleManifest.tenantId,
        eventId: sampleManifest.eventId,
        sessionId: sampleManifest.sessionId,
        manifest: sampleManifest
      });

      expect(res.status).toBe('published');
      expect(res.publishedAt).toBe('2026-10-19T08:05:00.000Z');
    });

    it('handles unauthorized (401), forbidden (403), conflict (409) and expired (410)', async () => {
      const transport = new HttpCloudSyncTransport({ baseUrl: 'http://test-portal:4000' });

      // 401
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 401,
        json: async () => ({ errorCode: 'TOKEN_EXPIRED' })
      });
      const reg401 = await transport.registerSession({
        idempotencyKey: 'key-1',
        manifest: sampleManifest
      });
      expect(reg401.status).toBe('unauthorized');

      // 403
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 403,
        json: async () => ({ errorCode: 'OPERATOR_REVOKED' })
      });
      const reg403 = await transport.registerSession({
        idempotencyKey: 'key-2',
        manifest: sampleManifest
      });
      expect(reg403.status).toBe('forbidden_revoked');

      // 409 conflict
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 409,
        json: async () => ({ errorCode: 'IMMUTABLE_OBJECT_CONFLICT' })
      });
      const up409 = await transport.uploadAssetObject({
        tenantId: sampleManifest.tenantId,
        eventId: sampleManifest.eventId,
        sessionId: sampleManifest.sessionId,
        assetId: sampleManifest.assets[0]!.assetId,
        storagePath: '...',
        buffer: Buffer.from('x'),
        sha256: sampleManifest.assets[0]!.sha256,
        mimeType: 'image/jpeg'
      });
      expect(up409.status).toBe('conflict_mismatch');

      // 410 expired
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 410,
        json: async () => ({ errorCode: 'SESSION_ALREADY_EXPIRED' })
      });
      const fin410 = await transport.finalizeSession({
        idempotencyKey: 'key-3',
        tenantId: sampleManifest.tenantId,
        eventId: sampleManifest.eventId,
        sessionId: sampleManifest.sessionId,
        manifest: sampleManifest
      });
      expect(fin410.status).toBe('rejected_expired');
    });

    it('redacts sensitive bearer tokens from error messages and diagnostics', async () => {
      const transport = new HttpCloudSyncTransport({
        baseUrl: 'http://test-portal:4000'
      });

      // Simulated network failure containing a bearer token in the error message
      globalThis.fetch = vi.fn().mockRejectedValue(
        new Error('Fetch failed with Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.topsecret')
      );

      const res = await transport.registerSession({
        idempotencyKey: 'key-token-leak-test',
        manifest: sampleManifest
      });

      expect(res.status).toBe('transient_error');
      expect(res.errorCode).toBeDefined();
      expect(res.errorCode).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.topsecret');
      expect(res.errorCode).toContain('[REDACTED_BEARER_TOKEN]');
    });
  });

  describe('Renderer Zustand Store Bridge Integration', () => {
    it('uses window.odcOperatorBridge when present in Electron environment', async () => {
      const mockBridge = {
        getPreflightStatus: vi.fn().mockResolvedValue({
          readyOffline: true,
          mode: 'real',
          simulationLabel: null,
          grantValid: true,
          grantReason: null,
          assetsVerified: true,
          diskSpaceOk: true,
          availableBytes: 10000000000,
          requiredBytes: 100000000,
          cameraReady: true,
          printerReady: true,
          clockHealthy: true,
          clockWarningReason: null
        }),
        startSession: vi.fn().mockResolvedValue({
          sessionId: '55000000-0000-4000-8000-000000000001'
        }),
        captureFrame: vi.fn().mockResolvedValue({
          assetId: '77000000-0000-4000-8000-000000000001',
          frameIndex: 0,
          captureState: 'capturing'
        }),
        approveSession: vi.fn().mockResolvedValue({
          sessionId: '55000000-0000-4000-8000-000000000001',
          captureState: 'approved',
          compositeState: 'ready',
          uploadState: 'uploading'
        }),
        submitPrint: vi.fn().mockResolvedValue({
          attemptId: '88000000-0000-4000-8000-000000000001',
          state: 'submitted',
          displayMessage: 'Submitted — check printer'
        }),
        resolveUnknownPrint: vi.fn().mockResolvedValue({
          attemptId: '88000000-0000-4000-8000-000000000001',
          state: 'confirmed'
        }),
        getSyncStatus: vi.fn().mockResolvedValue({
          queue: [
            {
              jobId: '99000000-0000-4000-8000-000000000001',
              sessionId: '55000000-0000-4000-8000-000000000001',
              uploadState: 'uploading',
              attemptCount: 1,
              diagnosticText: null,
              errorCode: null,
              nextAttemptAt: '2026-10-19T08:10:00.000Z',
              updatedAt: '2026-10-19T08:00:00.000Z'
            }
          ],
          pendingCount: 0,
          publishedCount: 0,
          failedCount: 0,
          blockedAuthCount: 0
        }),
        triggerSyncCycle: vi.fn().mockResolvedValue({
          processed: true,
          sessionId: '55000000-0000-4000-8000-000000000001',
          finalState: 'published'
        })
      };

      (globalThis as any).window = { odcOperatorBridge: mockBridge };

      const { useOperatorStore } = await import('../src/renderer/store.js');
      const store = useOperatorStore.getState();

      await store.loadInitialState();
      expect(mockBridge.getPreflightStatus).toHaveBeenCalled();
      expect(useOperatorStore.getState().mode).toBe('real');

      await store.triggerCaptureOrRetake(0);
      expect(mockBridge.startSession).toHaveBeenCalled();
      expect(mockBridge.captureFrame).toHaveBeenCalled();

      // Trigger sync
      await store.triggerSyncNow();
      expect(mockBridge.triggerSyncCycle).toHaveBeenCalled();
      expect(mockBridge.getSyncStatus).toHaveBeenCalled();

      delete (globalThis as any).window;
    });

    it('falls back to browser mock simulation when window.odcOperatorBridge is undefined', async () => {
      delete (globalThis as any).window;

      const { useOperatorStore } = await import('../src/renderer/store.js');
      const store = useOperatorStore.getState();

      store.startNextSession();
      expect(useOperatorStore.getState().captureState).toBe('created');

      store.triggerCaptureOrRetake(0);
      expect(useOperatorStore.getState().shotSlots[0]?.assetId).toBeDefined();

      store.approveSession();
      // Should not throw and should handle mock in-memory approval
      expect(useOperatorStore.getState().compositeState).toBeDefined();
    });
  });
});
