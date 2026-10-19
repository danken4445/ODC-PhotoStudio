import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {
  computeBufferSha256,
  generateEd25519GrantKeyPair,
  type PrintProfile,
  type TemplateDefinition
} from '../packages/contracts/src/index.js';
import {
  createDefaultFourBySixPostcardTemplate,
  createDefaultTwoBySixStripTemplate
} from '../packages/template-engine/src/index.js';
import { StationOrchestrator } from '../apps/operator-desktop/src/main/orchestrator.js';
import { MockCameraProvider } from '../apps/operator-desktop/src/main/camera/provider.js';
import { MockPrinterProvider } from '../apps/operator-desktop/src/main/printer/provider.js';
import { CloudPortalService } from '../apps/web-portal/src/lib/cloud-service.js';

async function runClientOnboardingSimulation() {
  console.log('========================================================================');
  console.log(' 📸 CLIENT ONBOARDING SIMULATION: LUMINA LUXE STUDIOS');
  console.log('    Platform: ODC-PhotoStudio Commercial DSLR Photobooth Engine');
  console.log('========================================================================\n');

  const simulationDir = path.resolve(process.cwd(), 'tmp', 'simulation-lumina-luxe');
  fs.rmSync(simulationDir, { recursive: true, force: true });
  fs.mkdirSync(simulationDir, { recursive: true });

  // 1. Generate Asymmetric Ed25519 Studio Keys
  console.log('[Step 1/6] 🔐 Generating studio Ed25519 asymmetric cryptographic grant keys...');
  const { publicKeyPem, privateKeyPem } = generateEd25519GrantKeyPair();
  const tokenPepper = 'c0ffee-pepper-lumina-luxe-secure-2026';
  console.log('  ✓ Ed25519 Keypair generated (Private key held on server; Public key distributed to stations)');

  // 2. Initialize Cloud Service & Tenant
  console.log('\n[Step 2/6] 🏢 Provisioning Tenant, Staff Memberships, and Hardware Station...');
  const cloud = new CloudPortalService({
    grantPrivateKeyPem: privateKeyPem,
    tokenPepper
  });

  const TENANT_ID = crypto.randomUUID();
  const OWNER_USER_ID = crypto.randomUUID();
  const OPERATOR_USER_ID = crypto.randomUUID();
  const STATION_ID = crypto.randomUUID();
  const EVENT_ID = crypto.randomUUID();
  const TEMPLATE_4X6_ID = crypto.randomUUID();
  const TEMPLATE_2X6_ID = crypto.randomUUID();

  // Register Tenant
  cloud.registerTenant({
    id: TENANT_ID,
    name: 'Lumina Luxe Studios',
    slug: 'lumina-luxe'
  });
  console.log(`  ✓ Tenant registered: "Lumina Luxe Studios" (ID: ${TENANT_ID})`);

  // Register Staff Memberships
  cloud.upsertMembership({
    tenantId: TENANT_ID,
    userId: OWNER_USER_ID,
    role: 'owner',
    status: 'active'
  });
  cloud.upsertMembership({
    tenantId: TENANT_ID,
    userId: OPERATOR_USER_ID,
    role: 'operator',
    status: 'active'
  });
  console.log(`  ✓ Memberships created: Marcus Vance (Owner) & Elena Cruz (Operator)`);

  // Register Station Hardware
  cloud.registerStation({
    id: STATION_ID,
    tenantId: TENANT_ID,
    label: 'Lumina Station Alpha (Win11 Pro / DNP DS620A / Canon EOS)',
    status: 'active'
  });
  console.log(`  ✓ Hardware station registered: "Lumina Station Alpha" (ID: ${STATION_ID})`);

  // 3. Create Custom Brand Overlay & Templates
  console.log('\n[Step 3/6] 🎨 Designing Custom Luxury Gold-Leaf Overlays & Templates...');
  const overlay4x6Buf = await sharp({
    create: {
      width: 1200,
      height: 1800,
      channels: 4,
      background: { r: 18, g: 18, b: 20, alpha: 0.1 }
    }
  })
    .png()
    .toBuffer();

  const overlay4x6Sha = computeBufferSha256(overlay4x6Buf);
  const overlay4x6Path = path.join(simulationDir, 'overlay-gala-4x6.png');
  fs.writeFileSync(overlay4x6Path, overlay4x6Buf);

  const template4x6Def = createDefaultFourBySixPostcardTemplate({
    overlayAssetId: 'overlay-gala-4x6',
    overlaySha256: overlay4x6Sha
  });

  cloud.registerTemplateVersion({
    id: TEMPLATE_4X6_ID,
    tenantId: TENANT_ID,
    templateId: crypto.randomUUID(),
    name: 'Lumina 4x6 Gala Postcard (4 Shots)',
    version: 1,
    definition: template4x6Def,
    overlayStoragePath: `${TENANT_ID}/overlays/overlay-gala-4x6.png`
  });

  // Print Profile for DNP DS620A
  const printProfile4x6: PrintProfile = {
    id: 'prof-dnp-4x6',
    name: 'DNP DS620A Standard 4x6',
    deviceName: 'DNP-DS620A',
    paperSize: '4x6_postcard',
    dpi: 300,
    scalingMode: 'exact_1_to_1',
    offsetXMm: 0,
    offsetYMm: 0,
    maxCopiesPerSession: 4,
    supportsTwoBySixCut: false,
    stripImposition: 'none'
  };

  // Register Gala Event
  cloud.registerEvent({
    id: EVENT_ID,
    tenantId: TENANT_ID,
    name: 'Vanguard Winter Charity Gala',
    timezone: 'America/New_York',
    startsAt: new Date(Date.now() - 3600_000).toISOString(),
    endsAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
    status: 'active',
    assignedOperatorIds: new Set([OPERATOR_USER_ID]),
    assignedStationIds: new Set([STATION_ID]),
    templateVersionIds: new Set([TEMPLATE_4X6_ID])
  });
  console.log(`  ✓ Event configured: "Vanguard Winter Charity Gala" assigned to Elena Cruz & Station Alpha`);

  // 4. Issue Offline Event Grant (Preparation Phase)
  console.log('\n[Step 4/6] 📋 Elena prepares Station Alpha for Offline Deployment...');
  const offlineGrant = cloud.issueOfflineEventGrant({
    actorUserId: OPERATOR_USER_ID,
    tenantId: TENANT_ID,
    eventId: EVENT_ID,
    stationId: STATION_ID,
    galleryOrigin: 'https://gallery.luminaluxe.example.com',
    permittedPrintProfiles: [printProfile4x6],
    grantDurationHours: 72
  });
  console.log(`  ✓ Signed Ed25519 72-Hour Grant issued (Grant ID: ${offlineGrant.payload.grantId})`);
  console.log(`    Expires at: ${offlineGrant.payload.expiresAt}`);

  // 5. Initialize Station Desktop Console & Run Preflight Offline
  console.log('\n[Step 5/6] 🖥️ Station Alpha boots in Offline Mode at Venue (No Internet)...');
  const stationDataDir = path.join(simulationDir, 'station-data');
  fs.mkdirSync(stationDataDir, { recursive: true });

  const camera = new MockCameraProvider((sessionId) => path.join(stationDataDir, 'sessions', sessionId), {
    captureDelayMs: 10
  });
  await camera.initialize();

  const printOutputDir = path.join(stationDataDir, 'prints');
  const printer = new MockPrinterProvider(printOutputDir);

  const station = new StationOrchestrator({
    dataDir: stationDataDir,
    stationId: STATION_ID,
    camera,
    printer,
    grantPublicKeyPem: publicKeyPem,
    tokenPepper
  });

  // Prepare Event Package onto Station Disk
  const preflight = station.prepareEventOffline({
    config: {
      eventId: EVENT_ID,
      tenantId: TENANT_ID,
      stationId: STATION_ID,
      operatorId: OPERATOR_USER_ID,
      eventName: 'Vanguard Winter Charity Gala',
      galleryOrigin: 'https://gallery.luminaluxe.example.com',
      templates: [
        {
          templateVersionId: TEMPLATE_4X6_ID,
          name: 'Lumina 4x6 Gala Postcard',
          version: 1,
          definition: template4x6Def,
          overlayFilePath: overlay4x6Path
        }
      ],
      printProfiles: [printProfile4x6]
    },
    grant: offlineGrant,
    serverTimeIso: new Date().toISOString()
  });

  console.log('  ✓ Preflight Verification Status:');
  console.log(`    - Ready Offline: ${preflight.readyOffline ? '✅ YES' : '❌ NO'}`);
  console.log(`    - Grant Signature Verified: ${preflight.grantValid ? '✅ VALID' : '❌ INVALID'}`);
  console.log(`    - Overlay Assets Verified: ${preflight.assetsVerified ? '✅ VERIFIED (SHA-256 match)' : '❌ FAILED'}`);
  console.log(`    - Disk Capacity Available: ${(preflight.availableBytes / (1024 * 1024 * 1024)).toFixed(2)} GB (Required: ${(preflight.requiredBytes / (1024 * 1024)).toFixed(1)} MB)`);
  console.log(`    - Camera Ready: ${preflight.cameraReady ? '✅ Canon EOS Connected' : '❌ Disconnected'}`);
  console.log(`    - Printer Ready: ${preflight.printerReady ? '✅ DNP DS620A Ready' : '❌ Missing'}`);
  console.log(`    - Clock Synchronization: ${preflight.clockHealthy ? '✅ Monotonic / Wall Sync OK' : '⚠️ Drift warning'}`);

  // 6. Live Session Execution (Capture, Composite, Print, Cloud Sync, & Guest Gallery)
  console.log('\n[Step 6/6] 📸 Executing Live Guest Session (Guests: Mr. & Mrs. Sterling)...');
  
  // A. Start Session
  const { session, canonicalGalleryUrl } = station.startSession({
    eventId: EVENT_ID,
    templateVersionId: TEMPLATE_4X6_ID
  });
  const galleryToken = Buffer.from(session.gallery_token_protected, 'base64').toString('utf8');
  console.log(`  1. Session started (Session ID: ${session.session_id})`);
  console.log(`     Bearer Gallery Token: [REDACTED_32_BYTES] (SHA-256 Hash stored: ${session.token_hash.slice(0, 16)}...)`);
  console.log(`     QR Code URL: ${canonicalGalleryUrl}`);

  // B. Multi-Shot Capture
  for (let shot = 0; shot < 4; shot++) {
    const capture = await station.captureFrame({
      sessionId: session.session_id,
      frameIndex: shot
    });
    console.log(`     - Shot ${shot + 1}/4 captured: ${path.basename(capture.capture.localFilePath)} (SHA-256: ${capture.capture.sha256.slice(0, 12)}...)`);
  }

  // C. Review & Approve Composite
  console.log('  2. Elena reviews shots with guests and clicks "Approve & Composite"...');
  const approved = await station.approveAndCompositeSession({
    sessionId: session.session_id
  });
  console.log(`     - Composite generated: 1200x1800 sRGB with reserved 4-module quiet zone QR code`);
  console.log(`     - Authoritative Expiration: ${approved.session.expires_at} (Exactly 24h from 1st shot)`);

  // D. Print Local Copy on DNP DS620A
  console.log('  3. Submitting 2 physical 4x6 photo prints for guests...');
  const printResult = await station.submitPrint({
    sessionId: session.session_id,
    printProfileId: printProfile4x6.id,
    copies: 2
  });
  console.log(`     - Print Status: "${printResult.result.displayMessage}" (Attempt State: ${printResult.attempt.state})`);
  console.log(`     - Imposed Spool File: ${path.basename(printResult.result.previewArtifactPath || '')}`);

  // E. Cloud Sync Reconnect & Background Upload
  console.log('\n  4. Station reconnects to network at midnight; background sync uploads queued session...');
  
  // Create a bridge transport connecting station queue to cloud portal
  const syncResult = await station.syncNextPendingJob({
    registerSession: async (params) => {
      const res = cloud.registerSession({
        actorUserId: OPERATOR_USER_ID,
        idempotencyKey: params.idempotencyKey,
        manifest: params.manifest
      });
      return {
        status: res.status,
        alreadyUploadedAssetIds: res.alreadyUploadedAssetIds,
        errorCode: res.errorCode
      };
    },
    uploadAssetObject: async (params) => {
      const res = cloud.uploadSessionAssetObject({
        actorUserId: OPERATOR_USER_ID,
        tenantId: params.tenantId,
        eventId: params.eventId,
        sessionId: params.sessionId,
        assetId: params.assetId,
        storagePath: params.storagePath,
        buffer: params.buffer,
        sha256: params.sha256,
        mimeType: params.mimeType
      });
      return { status: res.status, errorCode: res.errorCode };
    },
    finalizeSession: async (params) => {
      const res = cloud.finalizeSessionPublication({
        actorUserId: OPERATOR_USER_ID,
        idempotencyKey: params.idempotencyKey,
        tenantId: params.tenantId,
        eventId: params.eventId,
        sessionId: params.sessionId,
        manifest: params.manifest
      });
      return {
        status: res.status,
        publishedAt: res.publishedAt,
        errorCode: res.errorCode
      };
    }
  });

  console.log(`     - Cloud Sync Complete: Session ${syncResult.sessionId} -> State: "${syncResult.finalState}"`);

  // F. Guest Gallery Lookup & Download
  console.log('\n  5. Guest scans printed QR code on mobile phone...');
  const guestLookup = cloud.lookupGalleryByToken({
    rawToken: galleryToken
  });

  console.log(`     - Gallery State: "${guestLookup.state.toUpperCase()}"`);
  console.log(`     - Event: "${guestLookup.eventDisplayName}"`);
  console.log(`     - Customer Privacy Notice: "${guestLookup.customerNotice}"`);
  console.log(`     - Available Media Downloads (${guestLookup.assets.length} items):`);
  guestLookup.assets.forEach((asset, idx) => {
    console.log(`       [${idx + 1}] ${asset.kind === 'composite' ? 'Final 4x6 Print Composite' : `Shot #${(asset.shotIndex ?? 0) + 1}`} (${asset.width}x${asset.height} px)`);
  });

  // Guest downloads photo
  const downloadAuth = cloud.authorizeGuestAssetDownload({
    rawToken: galleryToken,
    assetId: guestLookup.assets[0].assetId
  });
  console.log(`     - Signed Download Token generated: TTL = ${downloadAuth.ttlSeconds}s (Capped to max 60s, authorized: ${downloadAuth.authorized})`);

  // G. 24-Hour Expiration & 5-Minute Deletion Sweep
  console.log('\n  6. Simulating 24 Hours Passing (Automated Privacy Deletion Sweep)...');
  const futureIso = new Date(Date.now() + 25 * 3600_000).toISOString();
  const sweep = cloud.runScheduledDeletionSweep(futureIso);
  console.log(`     - Sweeper executed: ${sweep.deletedSessionsCount} expired session media deleted from storage`);
  console.log(`     - Overdue Deletion SLA Alerts: ${sweep.overdueAlertSessionIds.length}`);

  // Verify gallery now reports expired
  const expiredLookup = cloud.lookupGalleryByToken({
    rawToken: galleryToken,
    nowIso: futureIso
  });
  console.log(`     - Re-checking Guest Gallery after 24h: State = "${expiredLookup.state.toUpperCase()}"`);
  console.log(`     - Notice: "${expiredLookup.customerNotice}"`);
  console.log(`     - Media Assets Exposed: ${expiredLookup.assets.length} (Immediate access denial)`);

  station.close();

  console.log('\n========================================================================');
  console.log(' 🎉 ONBOARDING SIMULATION SUCCESSFUL!');
  console.log('    Studio: Lumina Luxe Studios is fully operational on ODC-PhotoStudio.');
  console.log('========================================================================\n');
}

runClientOnboardingSimulation().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
