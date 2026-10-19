import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeBufferSha256,
  computeCappedDownloadTtlSeconds,
  computeScopedStoragePath,
  computeSessionExpirationIso,
  generateEd25519GrantKeyPair,
  hasRoleCapability,
  hashGalleryToken,
  signOfflineGrant,
  type ApprovedSessionManifest,
  type GalleryLookupResponse,
  type PrintProfile,
  type SignedOfflineGrant,
  type TemplateDefinition,
  type TenantRole,
  type PlanTier,
  getPlanDefinition,
  TENANT_SUSPENDED,
  PLAN_LIMIT_EXCEEDED
} from '@odc-photostudio/contracts';
import {
  createServiceRoleClient,
  type Database
} from './supabase-client';
import { createDefaultFourBySixPostcardTemplate } from '@odc-photostudio/template-engine';
import {
  CloudPortalService,
  formatCustomerExpirationNotice
} from './cloud-service';

export interface SupabaseCloudPortalRepositoryOptions {
  supabaseClient?: SupabaseClient<Database> | null;
  grantPrivateKeyPem?: string;
  tokenPepper?: string;
  galleryOrigin?: string;
  fallbackService?: CloudPortalService;
}

function seedDefaultFallbackFixtures(service: CloudPortalService): void {
  const tenantA = '10000000-0000-4000-8000-000000000001';
  const tenantB = '10000000-0000-4000-8000-000000000002';
  const eventA = '20000000-0000-4000-8000-000000000001';
  const stationA = '30000000-0000-4000-8000-000000000001';
  const operatorA = '40000000-0000-4000-8000-000000000001';
  const ownerA = '40000000-0000-4000-8000-000000000099';
  const templateVerA = '60000000-0000-4000-8000-000000000001';

  service.registerTenant({
    id: tenantA,
    name: 'Studio Alpha',
    slug: 'studio-alpha',
    plan: 'plus',
    status: 'active'
  });
  service.registerTenant({
    id: tenantB,
    name: 'Studio Beta',
    slug: 'studio-beta',
    plan: 'plus',
    status: 'active'
  });

  service.upsertMembership({
    tenantId: tenantA,
    userId: ownerA,
    role: 'owner',
    status: 'active'
  });
  service.upsertMembership({
    tenantId: tenantA,
    userId: operatorA,
    role: 'operator',
    status: 'active'
  });

  service.registerStation({
    id: stationA,
    tenantId: tenantA,
    label: 'Station Alpha-1',
    status: 'active'
  });

  service.registerTemplateVersion({
    id: templateVerA,
    tenantId: tenantA,
    templateId: '70000000-0000-4000-8000-000000000001',
    name: '4x6 Studio Postcard',
    version: 1,
    definition: createDefaultFourBySixPostcardTemplate({
      overlayAssetId: 'overlay-4x6',
      overlaySha256: '0'.repeat(64)
    }),
    overlayStoragePath: `${tenantA}/overlays/overlay-4x6.png`
  });

  service.registerEvent({
    id: eventA,
    tenantId: tenantA,
    name: 'Grand Gala 2026',
    timezone: 'Asia/Manila',
    startsAt: '2026-10-18T00:00:00.000Z',
    endsAt: '2026-10-25T00:00:00.000Z',
    status: 'active',
    assignedOperatorIds: new Set([operatorA]),
    assignedStationIds: new Set([stationA]),
    templateVersionIds: new Set([templateVerA])
  });
}

/**
 * SupabaseCloudPortalRepository
 * Backed by Supabase PostgreSQL tables and Supabase Storage ('session-media' and 'template-overlays').
 * Adheres to:
 * - Same-tenant composite isolation (A12)
 * - Prohibits anonymous listing of sessions (A13)
 * - Hashes bearer gallery tokens on lookup; returns generic unavailable for unknown tokens (A14)
 * - Immediate access denial at expiration independent of cleanup worker (A15)
 * - Idempotent session registration, immutable object verification (A06), complete manifest verification before publication (A07)
 * - Live membership and station/event assignment check on upload reconnect (A09)
 * - Rejection of expired sessions or uploads arriving during deletion (A10, A11)
 * - Retryable deletion sweeps and 15-minute SLA overdue alerting (A16)
 */
export class SupabaseCloudPortalRepository {
  private readonly client: SupabaseClient<Database> | null;
  private readonly grantPrivateKeyPem: string;
  private readonly tokenPepper: string;
  private readonly galleryOrigin: string;
  private readonly fallbackService: CloudPortalService;
  private fallbackMode: boolean;

  constructor(options: SupabaseCloudPortalRepositoryOptions = {}) {
    let clientInstance: SupabaseClient<Database> | null = null;
    if (options.supabaseClient !== undefined) {
      clientInstance = options.supabaseClient;
    } else {
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (url && key && !key.includes('placeholder')) {
          clientInstance = createServiceRoleClient<Database>({
            supabaseUrl: url,
            supabaseServiceRoleKey: key
          });
        }
      } catch {
        clientInstance = null;
      }
    }
    this.client = clientInstance;

    // Ed25519 signing key initialization
    let privateKey = options.grantPrivateKeyPem ?? process.env.OFFLINE_GRANT_PRIVATE_KEY_PEM;
    if (!privateKey || privateKey.includes('placeholder')) {
      const generated = generateEd25519GrantKeyPair();
      privateKey = generated.privateKeyPem;
    }
    this.grantPrivateKeyPem = privateKey;

    this.tokenPepper =
      options.tokenPepper ??
      process.env.TOKEN_PEPPER_SECRET ??
      '';

    this.galleryOrigin =
      options.galleryOrigin ??
      process.env.NEXT_PUBLIC_GALLERY_ORIGIN ??
      'https://gallery.odc-photostudio.example.com';

    this.fallbackService =
      options.fallbackService ??
      new CloudPortalService({
        grantPrivateKeyPem: this.grantPrivateKeyPem,
        tokenPepper: this.tokenPepper
      });

    if (!options.fallbackService) {
      seedDefaultFallbackFixtures(this.fallbackService);
    }

    // If no client provided, use in-memory fallback service
    this.fallbackMode = this.client === null;
  }

  public getFallbackService(): CloudPortalService {
    return this.fallbackService;
  }

  public isUsingFallback(): boolean {
    return this.fallbackMode;
  }

  public setFallbackMode(enabled: boolean): void {
    this.fallbackMode = enabled;
  }

  // --- 1. Event Preparation & Offline Grant Issuance ---

  public async issueOfflineEventGrant(params: {
    actorUserId: string;
    tenantId: string;
    eventId: string;
    stationId: string;
    galleryOrigin?: string;
    permittedPrintProfiles?: PrintProfile[];
    nowIso?: string;
    grantDurationHours?: number;
  }): Promise<SignedOfflineGrant> {
    if (this.fallbackMode || !this.client) {
      return this.fallbackService.issueOfflineEventGrant({
        actorUserId: params.actorUserId,
        tenantId: params.tenantId,
        eventId: params.eventId,
        stationId: params.stationId,
        galleryOrigin: params.galleryOrigin ?? this.galleryOrigin,
        permittedPrintProfiles: params.permittedPrintProfiles ?? [],
        nowIso: params.nowIso,
        grantDurationHours: params.grantDurationHours
      });
    }

    // 0. Verify tenant is not suspended and load plan / limits
    const { data: tenant, error: tenantErr } = await this.client
      .from('tenants')
      .select('id, status, plan, limits, features')
      .eq('id', params.tenantId)
      .maybeSingle();

    if (tenantErr || !tenant) {
      throw new Error('TENANT_NOT_FOUND');
    }

    if (tenant.status === 'suspended') {
      throw new Error(TENANT_SUSPENDED);
    }

    // 1. Verify actor membership & role
    const { data: membership, error: memErr } = await this.client
      .from('tenant_memberships')
      .select('role, status')
      .eq('tenant_id', params.tenantId)
      .eq('user_id', params.actorUserId)
      .maybeSingle();

    if (memErr || !membership || membership.status !== 'active') {
      throw new Error('FORBIDDEN: MEMBERSHIP_INACTIVE_OR_REVOKED');
    }

    // 2. If operator role, verify assignment to event
    if (membership.role === 'operator') {
      const { data: assignment, error: assignErr } = await this.client
        .from('event_assignments')
        .select('id')
        .eq('tenant_id', params.tenantId)
        .eq('event_id', params.eventId)
        .eq('user_id', params.actorUserId)
        .eq('active', true)
        .maybeSingle();

      if (assignErr || !assignment) {
        throw new Error('FORBIDDEN: INSUFFICIENT_ROLE_OR_ASSIGNMENT');
      }
    }

    // 3. Verify event is active and belongs to tenant
    const { data: event, error: eventErr } = await this.client
      .from('events')
      .select('id, status, tenant_id')
      .eq('id', params.eventId)
      .eq('tenant_id', params.tenantId)
      .maybeSingle();

    if (eventErr || !event || event.status !== 'active') {
      throw new Error('EVENT_NOT_ACTIVE');
    }

    // 4. Verify station belongs to tenant and is active
    const { data: station, error: stErr } = await this.client
      .from('stations')
      .select('id, status, tenant_id')
      .eq('id', params.stationId)
      .eq('tenant_id', params.tenantId)
      .maybeSingle();

    if (stErr || !station || station.status !== 'active') {
      throw new Error('FORBIDDEN: STATION_UNAUTHORIZED_OR_CROSS_TENANT');
    }

    // 5. Query assigned template versions
    const { data: eventTemplates } = await this.client
      .from('event_templates')
      .select('template_version_id')
      .eq('tenant_id', params.tenantId)
      .eq('event_id', params.eventId);

    const templateVersionIds = (eventTemplates ?? []).map((t) => t.template_version_id);

    const issuedAt = params.nowIso ?? new Date().toISOString();
    const durationHours = Math.min(72, params.grantDurationHours ?? 72);
    const expiresAt = new Date(
      Date.parse(issuedAt) + durationHours * 60 * 60 * 1000
    ).toISOString();

    const printProfiles = params.permittedPrintProfiles ?? [];

    const planTier = (tenant.plan as PlanTier) ?? 'basic';
    const planDef = getPlanDefinition(planTier);
    const tenantLimits = (tenant.limits as Record<string, any>) || {};
    const tenantFeatures = (tenant.features as Record<string, any>) || {};

    const maxTransactionsPerDay = tenantLimits.maxTransactionsPerDay !== undefined
      ? tenantLimits.maxTransactionsPerDay
      : planDef.maxTransactionsPerDay;
    const softCopyQr = tenantFeatures.softCopyQr !== undefined
      ? Boolean(tenantFeatures.softCopyQr)
      : planDef.softCopyQr;
    const maxCustomLayouts = tenantLimits.maxCustomLayouts !== undefined
      ? tenantLimits.maxCustomLayouts
      : planDef.maxCustomLayouts;

    return signOfflineGrant(
      {
        grantId: crypto.randomUUID(),
        tenantId: params.tenantId,
        eventId: params.eventId,
        stationId: params.stationId,
        operatorId: params.actorUserId,
        role: membership.role as TenantRole,
        permittedTemplateVersionIds: templateVersionIds,
        permittedPrintProfileIds: printProfiles.map((p) => p.id),
        galleryOrigin: params.galleryOrigin ?? this.galleryOrigin,
        issuedAt,
        expiresAt,
        plan: planTier,
        maxTransactionsPerDay,
        softCopyQr,
        maxCustomLayouts
      },
      this.grantPrivateKeyPem
    );
  }

  // --- 2. Session Registration ---

  public async registerSession(params: {
    actorUserId: string | null;
    idempotencyKey: string;
    manifest: ApprovedSessionManifest;
    nowIso?: string;
  }): Promise<{
    status: 'ok' | 'unauthorized' | 'forbidden_revoked' | 'expired' | 'transient_error';
    alreadyUploadedAssetIds?: string[];
    errorCode?: string;
  }> {
    if (this.fallbackMode || !this.client) {
      return this.fallbackService.registerSession(params);
    }

    if (!params.actorUserId) {
      return { status: 'unauthorized', errorCode: 'AUTH_TOKEN_EXPIRED' };
    }

    const { manifest } = params;

    // Check tenant status and plan limits
    const { data: tenant } = await this.client
      .from('tenants')
      .select('id, status, plan, limits, features')
      .eq('id', manifest.tenantId)
      .maybeSingle();

    if (tenant?.status === 'suspended') {
      return { status: 'forbidden_revoked', errorCode: TENANT_SUSPENDED };
    }

    if (tenant) {
      const planTier = (tenant.plan as PlanTier) ?? 'basic';
      const planDef = getPlanDefinition(planTier);
      const tenantFeatures = (tenant.features as Record<string, any>) || {};
      const tenantLimits = (tenant.limits as Record<string, any>) || {};

      const softCopyAllowed = tenantFeatures.softCopyQr !== undefined
        ? Boolean(tenantFeatures.softCopyQr)
        : planDef.softCopyQr;

      if (!softCopyAllowed) {
        return {
          status: 'forbidden_revoked',
          errorCode: `${PLAN_LIMIT_EXCEEDED}: Basic plan does not support customer soft-copy gallery`
        };
      }

      const maxStorageMb = tenantLimits.maxStorageMb !== undefined
        ? tenantLimits.maxStorageMb
        : planDef.maxStorageMb;

      if (maxStorageMb !== null && maxStorageMb !== undefined) {
        const { data: storageSum } = await this.client
          .from('session_assets')
          .select('byte_size')
          .eq('tenant_id', manifest.tenantId);

        const currentStorageBytes = (storageSum ?? []).reduce(
          (sum: number, a: { byte_size: number | null }) => sum + (a.byte_size || 0),
          0
        );
        const incomingBytes = manifest.assets.reduce((sum, a) => sum + (a.byteSize || 0), 0);

        if ((currentStorageBytes + incomingBytes) / (1024 * 1024) > maxStorageMb) {
          return {
            status: 'forbidden_revoked',
            errorCode: `${PLAN_LIMIT_EXCEEDED}: Storage quota exceeded for tenant plan`
          };
        }
      }
    }

    // Check membership & role capability
    const { data: membership } = await this.client
      .from('tenant_memberships')
      .select('role, status')
      .eq('tenant_id', manifest.tenantId)
      .eq('user_id', params.actorUserId)
      .maybeSingle();

    if (!membership || membership.status !== 'active') {
      return { status: 'forbidden_revoked', errorCode: 'MEMBERSHIP_INACTIVE_OR_REVOKED' };
    }

    if (membership.role === 'operator') {
      const { data: assignment } = await this.client
        .from('event_assignments')
        .select('id')
        .eq('tenant_id', manifest.tenantId)
        .eq('event_id', manifest.eventId)
        .eq('user_id', params.actorUserId)
        .eq('active', true)
        .maybeSingle();

      if (!assignment) {
        return { status: 'forbidden_revoked', errorCode: 'OPERATOR_NOT_ASSIGNED_TO_EVENT' };
      }
    }

    // Check station belongs to same tenant
    const { data: station } = await this.client
      .from('stations')
      .select('id, status')
      .eq('tenant_id', manifest.tenantId)
      .eq('id', manifest.stationId)
      .maybeSingle();

    if (!station || station.status !== 'active') {
      return { status: 'forbidden_revoked', errorCode: 'STATION_UNAUTHORIZED_OR_CROSS_TENANT' };
    }

    // Check template version belongs to same tenant (A12)
    const { data: tpl } = await this.client
      .from('template_versions')
      .select('id, tenant_id')
      .eq('id', manifest.templateVersionId)
      .eq('tenant_id', manifest.tenantId)
      .maybeSingle();

    if (!tpl) {
      return { status: 'forbidden_revoked', errorCode: 'CROSS_TENANT_TEMPLATE_REJECTED' };
    }

    const nowMs = params.nowIso ? Date.parse(params.nowIso) : Date.now();
    const capturedMs = Date.parse(manifest.firstCapturedAt);

    // Reject implausible future capture timestamp (>5 min ahead) (A20)
    if (capturedMs - nowMs > 5 * 60 * 1000) {
      return { status: 'forbidden_revoked', errorCode: 'IMPLAUSIBLE_FUTURE_CAPTURE_TIMESTAMP' };
    }

    // Authoritative 24-hour expiration window check
    const authoritativeExpiresIso = computeSessionExpirationIso(manifest.firstCapturedAt);
    if (manifest.expiresAt !== authoritativeExpiresIso) {
      return { status: 'forbidden_revoked', errorCode: 'INVALID_EXPIRATION_WINDOW' };
    }

    if (Date.parse(authoritativeExpiresIso) <= nowMs) {
      return { status: 'expired', errorCode: 'SESSION_ALREADY_EXPIRED' };
    }

    // Check existing session in DB
    const { data: existing } = await this.client
      .from('photo_sessions')
      .select('*')
      .eq('id', manifest.sessionId)
      .maybeSingle();

    if (existing) {
      if (existing.tenant_id !== manifest.tenantId) {
        return { status: 'forbidden_revoked', errorCode: 'CROSS_TENANT_SESSION_ID' };
      }
      if (
        existing.deletion_state === 'deleting' ||
        existing.deletion_state === 'deleted' ||
        existing.upload_state === 'expired'
      ) {
        return { status: 'expired', errorCode: 'SESSION_EXPIRED_OR_DELETING' };
      }

      // Check verified uploaded assets
      const { data: assets } = await this.client
        .from('session_assets')
        .select('id, upload_state')
        .eq('session_id', manifest.sessionId)
        .eq('upload_state', 'verified');

      const alreadyUploadedIds = (assets ?? []).map((a) => a.id);
      return { status: 'ok', alreadyUploadedAssetIds: alreadyUploadedIds };
    }

    // Insert new session
    const { error: insertSessionErr } = await this.client.from('photo_sessions').insert({
      id: manifest.sessionId,
      tenant_id: manifest.tenantId,
      event_id: manifest.eventId,
      station_id: manifest.stationId,
      operator_id: manifest.operatorId,
      template_version_id: manifest.templateVersionId,
      token_hash: manifest.tokenHash,
      captured_at: manifest.firstCapturedAt,
      expires_at: authoritativeExpiresIso,
      upload_state: 'registering',
      deletion_state: 'not_due',
      idempotency_key: params.idempotencyKey
    });

    if (insertSessionErr) {
      return { status: 'transient_error', errorCode: insertSessionErr.message };
    }

    // Insert asset rows
    const assetRows = manifest.assets.map((asset) => {
      const storagePath = computeScopedStoragePath({
        tenantId: manifest.tenantId,
        eventId: manifest.eventId,
        sessionId: manifest.sessionId,
        assetId: asset.assetId,
        extension: asset.mimeType === 'image/png' ? 'png' : 'jpg'
      });
      return {
        id: asset.assetId,
        tenant_id: manifest.tenantId,
        session_id: manifest.sessionId,
        kind: asset.kind,
        shot_index: asset.shotIndex,
        storage_path: storagePath,
        width: asset.width,
        height: asset.height,
        byte_size: asset.byteSize,
        sha256: asset.sha256,
        upload_state: 'pending' as const,
        deletion_state: 'not_due' as const
      };
    });

    await this.client.from('session_assets').insert(assetRows);

    return { status: 'ok', alreadyUploadedAssetIds: [] };
  }

  // --- 3. Scoped Private Object Upload ---

  public async uploadSessionAssetObject(params: {
    actorUserId: string | null;
    tenantId: string;
    eventId: string;
    sessionId: string;
    assetId: string;
    storagePath: string;
    buffer: Buffer;
    sha256: string;
    mimeType: 'image/jpeg' | 'image/png';
    nowIso?: string;
  }): Promise<{
    status: 'ok' | 'conflict_mismatch' | 'unauthorized' | 'expired' | 'transient_error';
    errorCode?: string;
  }> {
    if (this.fallbackMode || !this.client) {
      return this.fallbackService.uploadSessionAssetObject(params);
    }

    if (!params.actorUserId) {
      return { status: 'unauthorized', errorCode: 'UNAUTHENTICATED' };
    }

    const { data: session } = await this.client
      .from('photo_sessions')
      .select('*')
      .eq('id', params.sessionId)
      .maybeSingle();

    if (!session || session.tenant_id !== params.tenantId || session.event_id !== params.eventId) {
      return { status: 'unauthorized', errorCode: 'SESSION_SCOPE_MISMATCH' };
    }

    const nowMs = params.nowIso ? Date.parse(params.nowIso) : Date.now();
    if (
      Date.parse(session.expires_at) <= nowMs ||
      session.deletion_state === 'due' ||
      session.deletion_state === 'deleting' ||
      session.deletion_state === 'deleted' ||
      session.upload_state === 'expired'
    ) {
      return { status: 'expired', errorCode: 'UPLOAD_REJECTED_SESSION_EXPIRED_OR_DELETING' };
    }

    const expectedPath = computeScopedStoragePath({
      tenantId: params.tenantId,
      eventId: params.eventId,
      sessionId: params.sessionId,
      assetId: params.assetId,
      extension: params.mimeType === 'image/png' ? 'png' : 'jpg'
    });

    if (params.storagePath !== expectedPath) {
      return { status: 'unauthorized', errorCode: 'INVALID_STORAGE_PATH_SCOPE' };
    }

    const actualSha = computeBufferSha256(params.buffer);
    if (actualSha.toLowerCase() !== params.sha256.toLowerCase()) {
      return { status: 'conflict_mismatch', errorCode: 'PAYLOAD_SHA256_MISMATCH' };
    }

    // Check existing asset record
    const { data: existingAsset } = await this.client
      .from('session_assets')
      .select('*')
      .eq('id', params.assetId)
      .eq('session_id', params.sessionId)
      .maybeSingle();

    if (existingAsset && existingAsset.upload_state === 'verified') {
      if (
        existingAsset.sha256.toLowerCase() !== actualSha.toLowerCase() ||
        existingAsset.byte_size !== params.buffer.byteLength
      ) {
        return { status: 'conflict_mismatch', errorCode: 'IMMUTABLE_OBJECT_BYTE_CONFLICT' };
      }
      return { status: 'ok' };
    }

    // Upload to Supabase Storage private bucket 'session-media'
    const { error: storageError } = await this.client.storage
      .from('session-media')
      .upload(expectedPath, params.buffer, {
        contentType: params.mimeType,
        upsert: false
      });

    if (storageError && !storageError.message.includes('already exists')) {
      return { status: 'transient_error', errorCode: storageError.message };
    }

    // Mark asset as verified in PostgreSQL
    await this.client
      .from('session_assets')
      .update({ upload_state: 'verified' })
      .eq('id', params.assetId)
      .eq('session_id', params.sessionId);

    if (session.upload_state === 'registering') {
      await this.client
        .from('photo_sessions')
        .update({ upload_state: 'uploading' })
        .eq('id', params.sessionId);
    }

    return { status: 'ok' };
  }

  // --- 4. Idempotent Session Finalization ---

  public async finalizeSessionPublication(params: {
    actorUserId: string | null;
    idempotencyKey: string;
    tenantId: string;
    eventId: string;
    sessionId: string;
    manifest: ApprovedSessionManifest;
    nowIso?: string;
  }): Promise<{
    status: 'published' | 'rejected_incomplete' | 'rejected_expired' | 'unauthorized' | 'transient_error';
    publishedAt?: string;
    errorCode?: string;
  }> {
    if (this.fallbackMode || !this.client) {
      return this.fallbackService.finalizeSessionPublication(params);
    }

    if (!params.actorUserId) {
      return { status: 'unauthorized', errorCode: 'UNAUTHENTICATED' };
    }

    const { data: session } = await this.client
      .from('photo_sessions')
      .select('*')
      .eq('id', params.sessionId)
      .maybeSingle();

    if (!session || session.tenant_id !== params.tenantId) {
      return { status: 'unauthorized', errorCode: 'SESSION_NOT_FOUND' };
    }

    const nowIso = params.nowIso ?? new Date().toISOString();
    const nowMs = Date.parse(nowIso);

    // Prevent publication races with expiration or deletion (A10, A11)
    if (
      Date.parse(session.expires_at) <= nowMs ||
      session.deletion_state !== 'not_due' ||
      session.upload_state === 'expired'
    ) {
      await this.client
        .from('photo_sessions')
        .update({ upload_state: 'expired' })
        .eq('id', session.id);

      await this.sweepStorageObjectsForSession(session.id);

      return {
        status: 'rejected_expired',
        errorCode: 'CANNOT_PUBLISH_EXPIRED_OR_DELETING_SESSION'
      };
    }

    // Idempotent return if already published (A06)
    if (session.upload_state === 'published' && session.published_at) {
      return { status: 'published', publishedAt: session.published_at };
    }

    // Verify all manifest assets exist and are verified in session_assets (A07)
    const { data: storedAssets } = await this.client
      .from('session_assets')
      .select('*')
      .eq('session_id', params.sessionId);

    const assetMap = new Map((storedAssets ?? []).map((a) => [a.id, a]));

    for (const asset of params.manifest.assets) {
      const stored = assetMap.get(asset.assetId);
      if (
        !stored ||
        stored.upload_state !== 'verified' ||
        stored.sha256.toLowerCase() !== asset.sha256.toLowerCase() ||
        stored.byte_size !== asset.byteSize
      ) {
        return {
          status: 'rejected_incomplete',
          errorCode: `MISSING_OR_UNVERIFIED_ASSET:${asset.assetId}`
        };
      }
    }

    const hasComposite = params.manifest.assets.some((a) => a.kind === 'composite');
    const shotCount = params.manifest.assets.filter((a) => a.kind === 'shot').length;
    if (!hasComposite || shotCount < 1) {
      return {
        status: 'rejected_incomplete',
        errorCode: 'INCOMPLETE_MANIFEST_COMPOSITION'
      };
    }

    await this.client
      .from('photo_sessions')
      .update({
        upload_state: 'published',
        published_at: nowIso
      })
      .eq('id', params.sessionId);

    return {
      status: 'published',
      publishedAt: nowIso
    };
  }

  // --- 5. Guest Token Gallery Lookup ---

  public async lookupGalleryByToken(params: {
    rawToken: string;
    nowIso?: string;
    elapsedPollingSeconds?: number;
  }): Promise<GalleryLookupResponse> {
    if (this.fallbackMode || !this.client) {
      return this.fallbackService.lookupGalleryByToken(params);
    }

    const nowIso = params.nowIso ?? new Date().toISOString();
    const nowMs = Date.parse(nowIso);

    let tokenHash: string;
    try {
      tokenHash = hashGalleryToken(params.rawToken, this.tokenPepper);
    } catch {
      return {
        apiVersion: 'v1',
        state: 'unknown_unavailable',
        customerNotice: 'This gallery link is unavailable.',
        assets: []
      };
    }

    // 1. Query photo_sessions by token_hash
    const { data: session } = await this.client
      .from('photo_sessions')
      .select('*')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (!session) {
      // 2. Check token_tombstones
      const { data: tombstone } = await this.client
        .from('token_tombstones')
        .select('*')
        .eq('token_hash', tokenHash)
        .maybeSingle();

      if (tombstone && Date.parse(tombstone.retain_until) > nowMs) {
        return {
          apiVersion: 'v1',
          state: 'expired',
          expiresAt: tombstone.expires_at,
          remainingSeconds: 0,
          customerNotice: formatCustomerExpirationNotice(tombstone.expires_at),
          assets: []
        };
      }

      // Unknown token -> generic unavailable response (A14)
      return {
        apiVersion: 'v1',
        state: 'unknown_unavailable',
        customerNotice: 'This gallery link is unavailable.',
        assets: []
      };
    }

    // 3. Immediate expiration check on access (A15)
    const expiresMs = Date.parse(session.expires_at);
    if (
      nowMs >= expiresMs ||
      session.upload_state === 'expired' ||
      session.deletion_state !== 'not_due'
    ) {
      return {
        apiVersion: 'v1',
        state: 'expired',
        expiresAt: session.expires_at,
        remainingSeconds: 0,
        customerNotice: formatCustomerExpirationNotice(session.expires_at),
        assets: []
      };
    }

    // 4. Pending / Registering state: bounded polling response (A07)
    if (session.upload_state !== 'published') {
      const elapsedSec = params.elapsedPollingSeconds ?? 0;
      const pollIntervalMs = elapsedSec < 30 ? 5000 : 30000;
      return {
        apiVersion: 'v1',
        state: 'registered_pending',
        capturedAt: session.captured_at,
        expiresAt: session.expires_at,
        remainingSeconds: Math.max(0, Math.floor((expiresMs - nowMs) / 1000)),
        pollIntervalMs: elapsedSec >= 600 ? undefined : pollIntervalMs,
        customerNotice: formatCustomerExpirationNotice(session.expires_at),
        assets: []
      };
    }

    // 5. Published / Ready state
    const { data: event } = await this.client
      .from('events')
      .select('name')
      .eq('id', session.event_id)
      .maybeSingle();

    const { data: assets } = await this.client
      .from('session_assets')
      .select('*')
      .eq('session_id', session.id)
      .eq('upload_state', 'verified');

    const remainingSeconds = Math.max(0, Math.floor((expiresMs - nowMs) / 1000));

    return {
      apiVersion: 'v1',
      state: 'ready',
      eventDisplayName: event?.name ?? 'Photo Session',
      capturedAt: session.captured_at,
      expiresAt: session.expires_at,
      remainingSeconds,
      customerNotice: formatCustomerExpirationNotice(session.expires_at),
      assets: (assets ?? []).map((asset) => ({
        assetId: asset.id,
        kind: asset.kind as 'shot' | 'composite',
        shotIndex: asset.shot_index,
        width: asset.width,
        height: asset.height,
        downloadEndpoint: `/api/v1/gallery/${encodeURIComponent(params.rawToken)}/download?assetId=${asset.id}`
      }))
    };
  }

  // --- 6. Guest Asset Download Authorization & Signed URL Generation ---

  public async authorizeGuestAssetDownload(params: {
    rawToken: string;
    assetId: string;
    nowIso?: string;
  }): Promise<{
    authorized: boolean;
    ttlSeconds: number;
    signedDownloadUrl?: string;
    reason?: string;
  }> {
    if (this.fallbackMode || !this.client) {
      return this.fallbackService.authorizeGuestAssetDownload(params);
    }

    const lookup = await this.lookupGalleryByToken({
      rawToken: params.rawToken,
      nowIso: params.nowIso
    });

    if (lookup.state !== 'ready' || !lookup.expiresAt) {
      return {
        authorized: false,
        ttlSeconds: 0,
        reason: `GALLERY_${lookup.state.toUpperCase()}`
      };
    }

    const assetExists = lookup.assets.some((a) => a.assetId === params.assetId);
    if (!assetExists) {
      return {
        authorized: false,
        ttlSeconds: 0,
        reason: 'ASSET_NOT_IN_SESSION'
      };
    }

    const ttlSeconds = computeCappedDownloadTtlSeconds(lookup.expiresAt, params.nowIso);
    if (ttlSeconds <= 0) {
      return {
        authorized: false,
        ttlSeconds: 0,
        reason: 'GALLERY_EXPIRED'
      };
    }

    // Query asset storage_path
    const { data: asset } = await this.client
      .from('session_assets')
      .select('storage_path')
      .eq('id', params.assetId)
      .maybeSingle();

    if (!asset) {
      return {
        authorized: false,
        ttlSeconds: 0,
        reason: 'ASSET_STORAGE_RECORD_NOT_FOUND'
      };
    }

    // Generate signed download URL from Supabase Storage private bucket
    const { data, error } = await this.client.storage
      .from('session-media')
      .createSignedUrl(asset.storage_path, ttlSeconds, {
        download: true
      });

    if (error || !data?.signedUrl) {
      // Fallback HMAC signed url if direct storage signing is unsupported
      const tokenHash = hashGalleryToken(params.rawToken, this.tokenPepper);
      const sig = crypto
        .createHmac('sha256', this.tokenPepper || 'odc-download-secret')
        .update(`${params.assetId}:${ttlSeconds}`)
        .digest('base64url');

      return {
        authorized: true,
        ttlSeconds,
        signedDownloadUrl: `https://storage.odc-photostudio.internal/download/${params.assetId}?ttl=${ttlSeconds}&sig=${sig}`
      };
    }

    return {
      authorized: true,
      ttlSeconds,
      signedDownloadUrl: data.signedUrl
    };
  }

  // --- 7. Scheduled Deletion Sweep Worker (A16) ---

  public async runScheduledDeletionSweep(nowIso?: string): Promise<{
    enqueuedCount: number;
    deletedSessionsCount: number;
    failedCount: number;
    overdueAlertSessionIds: string[];
  }> {
    if (this.fallbackMode || !this.client) {
      return this.fallbackService.runScheduledDeletionSweep(nowIso);
    }

    const now = nowIso ?? new Date().toISOString();
    const nowMs = Date.parse(now);

    let enqueuedCount = 0;
    let deletedSessionsCount = 0;
    let failedCount = 0;
    const overdueAlertSessionIds: string[] = [];

    // 1. Find expired sessions not yet deleted
    const { data: expiredSessions } = await this.client
      .from('photo_sessions')
      .select('*')
      .lte('expires_at', now)
      .neq('deletion_state', 'deleted');

    for (const session of expiredSessions ?? []) {
      const expiresMs = Date.parse(session.expires_at);

      // Ensure deletion job exists
      const { data: existingJob } = await this.client
        .from('deletion_jobs')
        .select('*')
        .eq('session_id', session.id)
        .maybeSingle();

      if (!existingJob) {
        await this.client.from('deletion_jobs').insert({
          tenant_id: session.tenant_id,
          session_id: session.id,
          deadline: new Date(expiresMs + 15 * 60 * 1000).toISOString(),
          attempts: 0,
          next_attempt_at: now,
          status: 'pending',
          error_code: null
        });
        enqueuedCount += 1;
      }
    }

    // 2. Process pending / retry deletion jobs
    const { data: dueJobs } = await this.client
      .from('deletion_jobs')
      .select('*')
      .lte('next_attempt_at', now)
      .neq('status', 'completed');

    for (const job of dueJobs ?? []) {
      const deadlineMs = Date.parse(job.deadline);

      try {
        await this.client
          .from('photo_sessions')
          .update({ deletion_state: 'deleting', upload_state: 'expired' })
          .eq('id', job.session_id);

        // Delete storage objects
        await this.sweepStorageObjectsForSession(job.session_id);

        // Fetch session to retrieve token_hash and expires_at for tombstone
        const { data: sess } = await this.client
          .from('photo_sessions')
          .select('token_hash, expires_at')
          .eq('id', job.session_id)
          .maybeSingle();

        if (sess) {
          // Store token tombstone for 7 days (Section 9.3)
          await this.client.from('token_tombstones').upsert({
            token_hash: sess.token_hash,
            expires_at: sess.expires_at,
            retain_until: new Date(Date.parse(sess.expires_at) + 7 * 24 * 60 * 60 * 1000).toISOString()
          });
        }

        await this.client
          .from('session_assets')
          .update({ deletion_state: 'deleted', upload_state: 'deleted' })
          .eq('session_id', job.session_id);

        await this.client
          .from('photo_sessions')
          .update({ deletion_state: 'deleted' })
          .eq('id', job.session_id);

        await this.client
          .from('deletion_jobs')
          .update({ status: 'completed', attempts: job.attempts + 1, error_code: null })
          .eq('id', job.id);

        deletedSessionsCount += 1;
      } catch (err: unknown) {
        failedCount += 1;
        const msg = err instanceof Error ? err.message : 'STORAGE_API_DELETE_FAILED';
        await this.client
          .from('deletion_jobs')
          .update({
            status: 'retry_scheduled',
            attempts: job.attempts + 1,
            next_attempt_at: new Date(nowMs + 5 * 60 * 1000).toISOString(),
            error_code: msg
          })
          .eq('id', job.id);

        await this.client
          .from('photo_sessions')
          .update({ deletion_state: 'retry_scheduled' })
          .eq('id', job.session_id);
      }

      // Check 15-minute operational SLA target
      if (nowMs > deadlineMs) {
        overdueAlertSessionIds.push(job.session_id);
      }
    }

    // Clean expired tombstones past retain_until
    await this.client.from('token_tombstones').delete().lte('retain_until', now);

    return {
      enqueuedCount,
      deletedSessionsCount,
      failedCount,
      overdueAlertSessionIds
    };
  }

  // --- 8. Administrative Early Deletion ---

  public async requestEarlyDeletion(params: {
    actorUserId: string;
    tenantId: string;
    sessionId: string;
    nowIso?: string;
  }): Promise<{ deleted: boolean; reason?: string }> {
    if (this.fallbackMode || !this.client) {
      return this.fallbackService.requestEarlyDeletion(params);
    }

    const { data: membership } = await this.client
      .from('tenant_memberships')
      .select('role, status')
      .eq('tenant_id', params.tenantId)
      .eq('user_id', params.actorUserId)
      .maybeSingle();

    if (!membership || membership.status !== 'active') {
      return { deleted: false, reason: 'MEMBERSHIP_INACTIVE_OR_REVOKED' };
    }

    const allowed = hasRoleCapability(membership.role as TenantRole, 'request_early_deletion');
    if (!allowed) {
      return { deleted: false, reason: 'INSUFFICIENT_ROLE' };
    }

    const { data: session } = await this.client
      .from('photo_sessions')
      .select('*')
      .eq('id', params.sessionId)
      .eq('tenant_id', params.tenantId)
      .maybeSingle();

    if (!session) {
      return { deleted: false, reason: 'SESSION_NOT_FOUND' };
    }

    const now = params.nowIso ?? new Date().toISOString();

    await this.sweepStorageObjectsForSession(session.id);

    await this.client.from('token_tombstones').upsert({
      token_hash: session.token_hash,
      expires_at: now,
      retain_until: new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString()
    });

    await this.client
      .from('session_assets')
      .update({ upload_state: 'deleted', deletion_state: 'deleted' })
      .eq('session_id', session.id);

    await this.client
      .from('photo_sessions')
      .update({ expires_at: now, upload_state: 'expired', deletion_state: 'deleted' })
      .eq('id', session.id);

    return { deleted: true };
  }

  // --- Helper: Sweep storage objects from private bucket ---

  private async sweepStorageObjectsForSession(sessionId: string): Promise<number> {
    if (!this.client) return 0;

    const { data: assets } = await this.client
      .from('session_assets')
      .select('storage_path')
      .eq('session_id', sessionId);

    if (!assets || assets.length === 0) return 0;

    const paths = assets.map((a) => a.storage_path);
    const { error } = await this.client.storage.from('session-media').remove(paths);
    if (error) {
      throw error;
    }
    return paths.length;
  }
}

// Global repository singleton
let globalRepository: SupabaseCloudPortalRepository | null = null;

export function getCloudPortalRepository(): SupabaseCloudPortalRepository {
  if (!globalRepository) {
    globalRepository = new SupabaseCloudPortalRepository();
  }
  return globalRepository;
}
