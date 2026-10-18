import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  assertValidTransition,
  buildCanonicalGalleryUrl,
  computeBufferSha256,
  computeCappedDownloadTtlSeconds,
  computeExponentialBackoffMs,
  computeScopedStoragePath,
  computeSessionExpirationIso,
  generateEd25519GrantKeyPair,
  generateGalleryToken,
  hashGalleryToken,
  redactTokensFromText,
  signOfflineGrant,
  TemplateDefinitionSchema,
  verifyOfflineGrant
} from '../src/index.js';
import {
  applyPrintImposition,
  createDefaultFourBySixPostcardTemplate,
  createDefaultTwoBySixStripTemplate,
  renderCompositeImage
} from '@odc-photostudio/template-engine';

describe('@odc-photostudio/contracts & @odc-photostudio/template-engine', () => {
  it('enforces state transition guards across all 5 independent tracks', () => {
    expect(() => assertValidTransition('capture', 'created', 'capturing')).not.toThrow();
    expect(() => assertValidTransition('capture', 'approved', 'capturing')).toThrow(
      /Invalid state transition/
    );

    expect(() => assertValidTransition('composite', 'pending', 'rendering')).not.toThrow();
    expect(() => assertValidTransition('composite', 'ready', 'rendering')).toThrow(
      /Invalid state transition/
    );

    expect(() => assertValidTransition('print', 'submitting', 'unknown')).not.toThrow();
    expect(() => assertValidTransition('print', 'confirmed', 'submitting')).toThrow(
      /Invalid state transition/
    );

    expect(() => assertValidTransition('upload', 'published', 'uploading')).toThrow(
      /Invalid state transition/
    );

    expect(() => assertValidTransition('deletion', 'deleted', 'not_due')).toThrow(
      /Invalid state transition/
    );
  });

  it('signs and verifies Ed25519 offline grants and rejects grants > 72 hours or wrong station', () => {
    const { publicKeyPem, privateKeyPem } = generateEd25519GrantKeyPair();
    const tenantId = '10000000-0000-4000-8000-000000000001';
    const eventId = '20000000-0000-4000-8000-000000000001';
    const stationId = '30000000-0000-4000-8000-000000000001';
    const operatorId = '40000000-0000-4000-8000-000000000001';

    const grant = signOfflineGrant(
      {
        grantId: '50000000-0000-4000-8000-000000000001',
        tenantId,
        eventId,
        stationId,
        operatorId,
        role: 'operator',
        permittedTemplateVersionIds: ['60000000-0000-4000-8000-000000000001'],
        permittedPrintProfileIds: ['prof-4x6'],
        galleryOrigin: 'https://gallery.odc-photostudio.example.com',
        issuedAt: '2026-10-18T00:00:00.000Z',
        expiresAt: '2026-10-21T00:00:00.000Z'
      },
      privateKeyPem
    );

    const verified = verifyOfflineGrant(grant, publicKeyPem, {
      nowIso: '2026-10-19T12:00:00.000Z',
      expectedTenantId: tenantId,
      expectedEventId: eventId,
      expectedStationId: stationId,
      expectedOperatorId: operatorId
    });
    expect(verified.valid).toBe(true);

    // Reject wrong station
    const wrongStation = verifyOfflineGrant(grant, publicKeyPem, {
      nowIso: '2026-10-19T12:00:00.000Z',
      expectedStationId: '99999999-0000-4000-8000-000000000001'
    });
    expect(wrongStation.valid).toBe(false);
    expect(wrongStation.reason).toBe('STATION_MISMATCH');

    // Reject > 72 hours
    expect(() =>
      signOfflineGrant(
        {
          ...grant.payload,
          expiresAt: '2026-10-22T01:00:00.000Z'
        },
        privateKeyPem
      )
    ).toThrow(/cannot exceed 72 hours/);
  });

  it('rejects templates that clip the QR code or allow a photo slot to overlap the QR box', () => {
    const overlaySha = 'a'.repeat(64);
    const valid4x6 = createDefaultFourBySixPostcardTemplate({
      overlayAssetId: 'ov-1',
      overlaySha256: overlaySha
    });
    expect(() => TemplateDefinitionSchema.parse(valid4x6)).not.toThrow();

    // Overlap slot with QR box (x: 960, y: 1540, size: 200)
    expect(() =>
      TemplateDefinitionSchema.parse({
        ...valid4x6,
        slots: [
          ...valid4x6.slots,
          {
            id: 'overlapping-slot',
            photoIndex: 0,
            x: 900,
            y: 1500,
            width: 250,
            height: 250,
            rotationDeg: 0,
            fit: 'cover',
            focalPoint: { x: 0.5, y: 0.5 }
          }
        ]
      })
    ).toThrow(/overlaps reserved QR code region/);
  });

  it('renders deterministic 4x6 and 2x6 composites with QR code and strip imposition (A22)', async () => {
    const overlayBuffer = await sharp({
      create: {
        width: 1200,
        height: 1800,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .png()
      .toBuffer();

    const overlaySha256 = computeBufferSha256(overlayBuffer);
    const template = createDefaultFourBySixPostcardTemplate({
      overlayAssetId: 'overlay-4x6',
      overlaySha256
    });

    const shotBuffers = new Map<number, Buffer>();
    for (let i = 0; i < 4; i++) {
      const buf = await sharp({
        create: {
          width: 1200,
          height: 1600,
          channels: 3,
          background: { r: 50 * i, g: 100, b: 150 }
        }
      })
        .jpeg()
        .toBuffer();
      shotBuffers.set(i, buf);
    }

    const token = generateGalleryToken();
    const galleryUrl = buildCanonicalGalleryUrl(
      'https://gallery.odc-photostudio.example.com',
      token
    );

    const startMs = performance.now();
    const render1 = await renderCompositeImage({
      template,
      shotBuffersByIndex: shotBuffers,
      overlayBuffer,
      galleryUrl
    });
    const elapsedMs = performance.now() - startMs;

    const render2 = await renderCompositeImage({
      template,
      shotBuffersByIndex: shotBuffers,
      overlayBuffer,
      galleryUrl
    });

    // Performance target: 4-shot 4x6 compositing < 3000ms (Section 17)
    expect(elapsedMs).toBeLessThan(3000);
    expect(render1.width).toBe(1200);
    expect(render1.height).toBe(1800);
    // Deterministic output for identical inputs
    expect(render1.sha256).toBe(render2.sha256);

    // Test 2x6 strip imposition onto 4x6 sheet (600x1800 -> 1200x1800)
    const stripOverlay = await sharp({
      create: {
        width: 600,
        height: 1800,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .png()
      .toBuffer();

    const stripTemplate = createDefaultTwoBySixStripTemplate({
      overlayAssetId: 'overlay-2x6',
      overlaySha256: computeBufferSha256(stripOverlay)
    });

    const stripRender = await renderCompositeImage({
      template: stripTemplate,
      shotBuffersByIndex: shotBuffers,
      overlayBuffer: stripOverlay,
      galleryUrl
    });
    expect(stripRender.width).toBe(600);
    expect(stripRender.height).toBe(1800);

    const imposed = await applyPrintImposition(stripRender.compositeBuffer, {
      id: 'prof-2x6-cut',
      name: '2x6 Strip on 4x6 Media',
      deviceName: 'MOCK-PRINTER',
      paperSize: '2x6_strip',
      dpi: 300,
      scalingMode: 'exact_1_to_1',
      offsetXMm: 0,
      offsetYMm: 0,
      maxCopiesPerSession: 3,
      supportsTwoBySixCut: true,
      stripImposition: 'duplicate_2x6_on_4x6'
    });
    expect(imposed.width).toBe(1200);
    expect(imposed.height).toBe(1800);
  });

  it('validates token redaction, 24h expiration calculation, and capped 60s download TTL', () => {
    const token = generateGalleryToken();
    const hash = hashGalleryToken(token, 'pepper');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    const redacted = redactTokensFromText(
      `GET https://gallery.odc-photostudio.example.com/g/${token} Authorization: Bearer secret-jwt-123`
    );
    expect(redacted).not.toContain(token);
    expect(redacted).not.toContain('secret-jwt-123');
    expect(redacted).toContain('[REDACTED_GALLERY_TOKEN]');

    const exp = computeSessionExpirationIso('2026-10-18T10:00:00.000Z');
    expect(exp).toBe('2026-10-19T10:00:00.000Z');

    // Download URL TTL capped to min(60s, remaining gallery lifetime)
    expect(
      computeCappedDownloadTtlSeconds(
        '2026-10-19T10:00:00.000Z',
        '2026-10-19T09:50:00.000Z'
      )
    ).toBe(60);
    expect(
      computeCappedDownloadTtlSeconds(
        '2026-10-19T10:00:00.000Z',
        '2026-10-19T09:59:42.000Z'
      )
    ).toBe(18);
    expect(
      computeCappedDownloadTtlSeconds(
        '2026-10-19T10:00:00.000Z',
        '2026-10-19T10:00:00.000Z'
      )
    ).toBe(0);

    // Backoff capped at 5 minutes (300,000ms)
    expect(computeExponentialBackoffMs(20, 0)).toBe(300_000);

    const path = computeScopedStoragePath({
      tenantId: '10000000-0000-4000-8000-000000000001',
      eventId: '20000000-0000-4000-8000-000000000001',
      sessionId: '30000000-0000-4000-8000-000000000001',
      assetId: '40000000-0000-4000-8000-000000000001',
      extension: 'jpg'
    });
    expect(path).toBe(
      '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000001.jpg'
    );
  });
});
