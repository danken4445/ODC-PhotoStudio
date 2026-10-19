import crypto from 'node:crypto';
import {
  computeBufferSha256,
  computeCappedDownloadTtlSeconds,
  computeScopedStoragePath,
   computeSessionExpirationIso,
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

export interface CloudTenantRecord {
  id: string;
  name: string;
  slug: string;
  plan?: PlanTier;
  status?: 'active' | 'suspended' | 'closed';
  features?: Record<string, any>;
  limits?: Record<string, any>;
}

export interface CloudMembershipRecord {
  tenantId: string;
  userId: string;
  role: TenantRole;
  status: 'active' | 'revoked';
}

export interface CloudStationRecord {
  id: string;
  tenantId: string;
  label: string;
  status: 'active' | 'revoked';
}

export interface CloudEventRecord {
  id: string;
  tenantId: string;
  name: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  status: 'active' | 'closed';
  assignedOperatorIds: Set<string>;
  assignedStationIds: Set<string>;
  templateVersionIds: Set<string>;
}

export interface CloudTemplateVersionRecord {
  id: string;
  tenantId: string;
  templateId: string;
  name: string;
  version: number;
  definition: TemplateDefinition;
  overlayStoragePath: string;
}

export interface CloudSessionRecord {
  sessionId: string;
  tenantId: string;
  eventId: string;
  stationId: string;
  operatorId: string;
  templateVersionId: string;
  tokenHash: string;
  firstCapturedAt: string;
  expiresAt: string;
  publishedAt: string | null;
  uploadState: 'registering' | 'uploading' | 'verifying' | 'published' | 'failed' | 'expired';
  deletionState: 'not_due' | 'due' | 'deleting' | 'retry_scheduled' | 'deleted';
  manifest: ApprovedSessionManifest;
}

export interface CloudStoredObject {
  storagePath: string;
  tenantId: string;
  eventId: string;
  sessionId: string;
  assetId: string;
  sha256: string;
  byteSize: number;
  mimeType: 'image/jpeg' | 'image/png';
  bytes: Buffer;
  uploadedAt: string;
}

export interface CloudDeletionJob {
  jobId: string;
  tenantId: string;
  sessionId: string;
  deadline: string;
  attempts: number;
  nextAttemptAt: string;
  status: 'pending' | 'completed' | 'retry_scheduled';
  errorCode: string | null;
}

export const CUSTOMER_EXPIRATION_WORDING_TEMPLATE =
  'Digital downloads are available until [time]. After that, access closes and stored copies are scheduled for deletion.';

export function formatCustomerExpirationNotice(expiresAtIso: string): string {
  return CUSTOMER_EXPIRATION_WORDING_TEMPLATE.replace('[time]', expiresAtIso);
}

/**
 * Authoritative Cloud Portal & Multi-Tenant Security Service (Sections 8, 9, 10, 11, 16):
 * - Enforces same-tenant composite isolation (A12)
 * - Prohibits anonymous listing of sessions (A13)
 * - Hashes bearer gallery tokens on lookup; returns generic unavailable for unknown tokens (A14)
 * - Enforces immediate access denial at expiration independent of cleanup worker (A15)
 * - Enforces idempotent session registration, immutable object verification (A06), and complete manifest check before publication (A07)
 * - Re-verifies live operator membership and station/event assignment on upload reconnect (A09)
 * - Rejects publication of expired sessions or uploads arriving during deletion and sweeps late objects (A10, A11)
 * - Retries storage deletion failures and tracks overdue deletion alerts (A16)
 */
export class CloudPortalService {
  private readonly tenants = new Map<string, CloudTenantRecord>();
  private readonly memberships = new Map<string, CloudMembershipRecord>();
  private readonly stations = new Map<string, CloudStationRecord>();
  private readonly events = new Map<string, CloudEventRecord>();
  private readonly templateVersions = new Map<string, CloudTemplateVersionRecord>();
  private readonly sessions = new Map<string, CloudSessionRecord>();
  private readonly sessionsByTokenHash = new Map<string, string>();
  private readonly privateStorageObjects = new Map<string, CloudStoredObject>();
  private readonly deletionJobs = new Map<string, CloudDeletionJob>();
  private readonly tombstoneByTokenHash = new Map<
    string,
    { expiresAt: string; tombstoneRetainUntil: string }
  >();

  private readonly grantPrivateKeyPem: string;
  private readonly tokenPepper: string;
  private simulateStorageDeleteFailure = false;
  private simulateServiceOutage = false;

  constructor(params: { grantPrivateKeyPem: string; tokenPepper?: string }) {
    this.grantPrivateKeyPem = params.grantPrivateKeyPem;
    this.tokenPepper = params.tokenPepper ?? '';
  }

  public setSimulateStorageDeleteFailure(fail: boolean): void {
    this.simulateStorageDeleteFailure = fail;
  }

  public setSimulateServiceOutage(outage: boolean): void {
    this.simulateServiceOutage = outage;
  }

  // --- Tenant, Role & Event Provisioning ---

  public registerTenant(tenant: CloudTenantRecord): void {
    this.tenants.set(tenant.id, tenant);
  }

  public upsertMembership(membership: CloudMembershipRecord): void {
    this.memberships.set(`${membership.tenantId}:${membership.userId}`, membership);
  }

  public revokeOperatorMembership(tenantId: string, userId: string): void {
    const key = `${tenantId}:${userId}`;
    const existing = this.memberships.get(key);
    if (existing) {
      this.memberships.set(key, { ...existing, status: 'revoked' });
    }
  }

  public registerStation(station: CloudStationRecord): void {
    this.stations.set(station.id, station);
  }

  public registerTemplateVersion(tpl: CloudTemplateVersionRecord): void {
    this.templateVersions.set(tpl.id, tpl);
  }

  public registerEvent(event: CloudEventRecord): void {
    const tenant = this.tenants.get(event.tenantId);
    if (tenant?.status === 'suspended') {
      throw new Error(TENANT_SUSPENDED);
    }
    if (tenant && tenant.plan !== undefined) {
      const planTier = tenant.plan;
      const planDef = getPlanDefinition(planTier);
      const activeEventLimit = tenant.limits?.maxActiveEvents !== undefined
        ? tenant.limits.maxActiveEvents
        : planDef.maxActiveEvents;

      if (activeEventLimit !== null && activeEventLimit !== undefined) {
        let activeCount = 0;
        for (const ev of this.events.values()) {
          if (ev.tenantId === event.tenantId && ev.status === 'active' && ev.id !== event.id) {
            activeCount += 1;
          }
        }
        if (activeCount >= activeEventLimit) {
          throw new Error(`${PLAN_LIMIT_EXCEEDED}: Maximum active events limit reached for tenant plan`);
        }
      }
    }

    for (const tplId of event.templateVersionIds) {
      const tpl = this.templateVersions.get(tplId);
      if (!tpl || tpl.tenantId !== event.tenantId) {
        throw new Error('TENANT_ISOLATION_VIOLATION: Template version belongs to another tenant');
      }
    }
    for (const stId of event.assignedStationIds) {
      const st = this.stations.get(stId);
      if (!st || st.tenantId !== event.tenantId) {
        throw new Error('TENANT_ISOLATION_VIOLATION: Station belongs to another tenant');
      }
    }
    this.events.set(event.id, event);
  }

  public verifyActorAuthorization(params: {
    actorUserId: string | null;
    tenantId: string;
    capability: Parameters<typeof hasRoleCapability>[1];
    eventId?: string;
    stationId?: string;
  }): { authorized: boolean; reason?: string; role?: TenantRole } {
    if (!params.actorUserId) {
      return { authorized: false, reason: 'UNAUTHENTICATED' };
    }

    const membership = this.memberships.get(`${params.tenantId}:${params.actorUserId}`);
    if (!membership || membership.status !== 'active') {
      return { authorized: false, reason: 'MEMBERSHIP_INACTIVE_OR_REVOKED' };
    }

    let isAssignedToEvent = false;
    if (params.eventId) {
      const ev = this.events.get(params.eventId);
      if (!ev || ev.tenantId !== params.tenantId) {
        return { authorized: false, reason: 'CROSS_TENANT_EVENT_REJECTED' };
      }
      const userAssigned = ev.assignedOperatorIds.has(params.actorUserId);
      const stationAssigned = params.stationId
        ? ev.assignedStationIds.has(params.stationId)
        : true;
      isAssignedToEvent = userAssigned && stationAssigned;
    }

    if (params.stationId) {
      const st = this.stations.get(params.stationId);
      if (!st || st.tenantId !== params.tenantId || st.status !== 'active') {
        return { authorized: false, reason: 'STATION_UNAUTHORIZED_OR_CROSS_TENANT' };
      }
    }

    const allowed = hasRoleCapability(membership.role, params.capability, {
      isAssignedToEvent
    });
    if (!allowed) {
      return { authorized: false, reason: 'INSUFFICIENT_ROLE_OR_ASSIGNMENT' };
    }

    return { authorized: true, role: membership.role };
  }

  // --- API 1: Event Preparation & Offline Grant Issuance ---

  public issueOfflineEventGrant(params: {
    actorUserId: string;
    tenantId: string;
    eventId: string;
    stationId: string;
    galleryOrigin: string;
    permittedPrintProfiles: PrintProfile[];
    nowIso?: string;
    grantDurationHours?: number;
  }): SignedOfflineGrant {
    const tenant = this.tenants.get(params.tenantId);
    if (tenant?.status === 'suspended') {
      throw new Error(TENANT_SUSPENDED);
    }

    const auth = this.verifyActorAuthorization({
      actorUserId: params.actorUserId,
      tenantId: params.tenantId,
      capability: 'prepare_station_offline',
      eventId: params.eventId,
      stationId: params.stationId
    });
    if (!auth.authorized || !auth.role) {
      throw new Error(`FORBIDDEN: ${auth.reason ?? 'Cannot issue offline grant'}`);
    }

    const ev = this.events.get(params.eventId);
    if (!ev || ev.status !== 'active') {
      throw new Error('EVENT_NOT_ACTIVE');
    }

    const issuedAt = params.nowIso ?? new Date().toISOString();
    const durationHours = Math.min(72, params.grantDurationHours ?? 72);
    const expiresAt = new Date(
      Date.parse(issuedAt) + durationHours * 60 * 60 * 1000
    ).toISOString();

    const planTier = tenant?.plan;
    const planDef = planTier ? getPlanDefinition(planTier) : null;
    const maxTransactionsPerDay = tenant?.limits?.maxTransactionsPerDay !== undefined
      ? tenant.limits.maxTransactionsPerDay
      : planDef?.maxTransactionsPerDay;
    const softCopyQr = tenant?.features?.softCopyQr !== undefined
      ? Boolean(tenant.features.softCopyQr)
      : planDef?.softCopyQr;
    const maxCustomLayouts = tenant?.limits?.maxCustomLayouts !== undefined
      ? tenant.limits.maxCustomLayouts
      : planDef?.maxCustomLayouts;

    return signOfflineGrant(
      {
        grantId: crypto.randomUUID(),
        tenantId: params.tenantId,
        eventId: params.eventId,
        stationId: params.stationId,
        operatorId: params.actorUserId,
        role: auth.role,
        permittedTemplateVersionIds: [...ev.templateVersionIds],
        permittedPrintProfileIds: params.permittedPrintProfiles.map((p) => p.id),
        galleryOrigin: params.galleryOrigin,
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

  // --- API 2: Session Registration (with Reconnect Authorization & Clock Check) ---

  public registerSession(params: {
    actorUserId: string | null;
    idempotencyKey: string;
    manifest: ApprovedSessionManifest;
    nowIso?: string;
  }): {
    status: 'ok' | 'unauthorized' | 'forbidden_revoked' | 'expired' | 'transient_error';
    alreadyUploadedAssetIds?: string[];
    errorCode?: string;
  } {
    if (!params.actorUserId) {
      return { status: 'unauthorized', errorCode: 'AUTH_TOKEN_EXPIRED' };
    }

    const { manifest } = params;
    const tenant = this.tenants.get(manifest.tenantId);
    if (tenant?.status === 'suspended') {
      return {
        status: 'forbidden_revoked',
        errorCode: TENANT_SUSPENDED
      };
    }

    if (tenant && tenant.plan !== undefined) {
      const planTier = tenant.plan;
      const planDef = getPlanDefinition(planTier);
      const softCopyAllowed = tenant.features?.softCopyQr !== undefined
        ? Boolean(tenant.features.softCopyQr)
        : planDef.softCopyQr;

      if (!softCopyAllowed) {
        return {
          status: 'forbidden_revoked',
          errorCode: `${PLAN_LIMIT_EXCEEDED}: Basic plan does not support customer soft-copy gallery`
        };
      }

      const maxStorageMb = tenant.limits?.maxStorageMb !== undefined
        ? tenant.limits.maxStorageMb
        : planDef.maxStorageMb;

      if (maxStorageMb !== null && maxStorageMb !== undefined) {
        let currentStorageBytes = 0;
        for (const obj of this.privateStorageObjects.values()) {
          if (obj.tenantId === manifest.tenantId) {
            currentStorageBytes += obj.byteSize;
          }
        }
        const incomingBytes = manifest.assets.reduce((sum, a) => sum + (a.byteSize || 0), 0);
        if ((currentStorageBytes + incomingBytes) / (1024 * 1024) > maxStorageMb) {
          return {
            status: 'forbidden_revoked',
            errorCode: `${PLAN_LIMIT_EXCEEDED}: Storage quota exceeded for tenant plan`
          };
        }
      }
    }

    // Recheck live membership and station/event authorization on reconnect (Section 10.2 / A09)
    const auth = this.verifyActorAuthorization({
      actorUserId: params.actorUserId,
      tenantId: manifest.tenantId,
      capability: 'capture_upload_reprint',
      eventId: manifest.eventId,
      stationId: manifest.stationId
    });

    if (!auth.authorized) {
      return {
        status: 'forbidden_revoked',
        errorCode: auth.reason ?? 'OPERATOR_OR_STATION_REVOKED'
      };
    }

    // Verify template belongs to the same tenant (A12)
    const tpl = this.templateVersions.get(manifest.templateVersionId);
    if (!tpl || tpl.tenantId !== manifest.tenantId) {
      return {
        status: 'forbidden_revoked',
        errorCode: 'CROSS_TENANT_TEMPLATE_REJECTED'
      };
    }

    const nowMs = params.nowIso ? Date.parse(params.nowIso) : Date.now();
    const capturedMs = Date.parse(manifest.firstCapturedAt);

    // Server rejects implausible future capture timestamps (>5 min ahead of server clock) (Section 9.1 / A20)
    if (capturedMs - nowMs > 5 * 60 * 1000) {
      return {
        status: 'forbidden_revoked',
        errorCode: 'IMPLAUSIBLE_FUTURE_CAPTURE_TIMESTAMP'
      };
    }

    // Authoritative 24-hour rule check: server never defaults a delayed upload to a new 24h window
    const authoritativeExpiresIso = computeSessionExpirationIso(manifest.firstCapturedAt);
    if (manifest.expiresAt !== authoritativeExpiresIso) {
      return {
        status: 'forbidden_revoked',
        errorCode: 'INVALID_EXPIRATION_WINDOW'
      };
    }

    if (Date.parse(authoritativeExpiresIso) <= nowMs) {
      return { status: 'expired', errorCode: 'SESSION_ALREADY_EXPIRED' };
    }

    const existing = this.sessions.get(manifest.sessionId);
    if (existing) {
      if (existing.tenantId !== manifest.tenantId) {
        return { status: 'forbidden_revoked', errorCode: 'CROSS_TENANT_SESSION_ID' };
      }
      if (
        existing.deletionState === 'deleting' ||
        existing.deletionState === 'deleted' ||
        existing.uploadState === 'expired'
      ) {
        return { status: 'expired', errorCode: 'SESSION_EXPIRED_OR_DELETING' };
      }

      const uploadedIds: string[] = [];
      for (const asset of manifest.assets) {
        const path = computeScopedStoragePath({
          tenantId: manifest.tenantId,
          eventId: manifest.eventId,
          sessionId: manifest.sessionId,
          assetId: asset.assetId,
          extension: asset.mimeType === 'image/png' ? 'png' : 'jpg'
        });
        if (this.privateStorageObjects.has(path)) {
          uploadedIds.push(asset.assetId);
        }
      }

      return { status: 'ok', alreadyUploadedAssetIds: uploadedIds };
    }

    this.sessions.set(manifest.sessionId, {
      sessionId: manifest.sessionId,
      tenantId: manifest.tenantId,
      eventId: manifest.eventId,
      stationId: manifest.stationId,
      operatorId: manifest.operatorId,
      templateVersionId: manifest.templateVersionId,
      tokenHash: manifest.tokenHash,
      firstCapturedAt: manifest.firstCapturedAt,
      expiresAt: authoritativeExpiresIso,
      publishedAt: null,
      uploadState: 'registering',
      deletionState: 'not_due',
      manifest
    });
    this.sessionsByTokenHash.set(manifest.tokenHash, manifest.sessionId);

    return { status: 'ok', alreadyUploadedAssetIds: [] };
  }

  // --- API 3: Scoped Private Object Upload ---

  public uploadSessionAssetObject(params: {
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
  }): {
    status: 'ok' | 'conflict_mismatch' | 'unauthorized' | 'expired' | 'transient_error';
    errorCode?: string;
  } {
    if (!params.actorUserId) {
      return { status: 'unauthorized', errorCode: 'UNAUTHENTICATED' };
    }

    const auth = this.verifyActorAuthorization({
      actorUserId: params.actorUserId,
      tenantId: params.tenantId,
      capability: 'capture_upload_reprint',
      eventId: params.eventId
    });
    if (!auth.authorized) {
      return { status: 'unauthorized', errorCode: auth.reason };
    }

    const session = this.sessions.get(params.sessionId);
    if (!session || session.tenantId !== params.tenantId || session.eventId !== params.eventId) {
      return { status: 'unauthorized', errorCode: 'SESSION_SCOPE_MISMATCH' };
    }

    const nowMs = params.nowIso ? Date.parse(params.nowIso) : Date.now();
    // Handle in-flight uploads at expiration or during deletion (Section 8 / A10 / A11)
    if (
      Date.parse(session.expiresAt) <= nowMs ||
      session.deletionState === 'due' ||
      session.deletionState === 'deleting' ||
      session.deletionState === 'deleted'
    ) {
      return { status: 'expired', errorCode: 'UPLOAD_REJECTED_SESSION_EXPIRED_OR_DELETING' };
    }

    // Server assigns/validates canonical object path — client prefix is not authority (Section 8)
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

    // Repeating an upload must verify an existing matching object rather than replacing bytes (Section 8 / A06)
    const existingObj = this.privateStorageObjects.get(expectedPath);
    if (existingObj) {
      if (
        existingObj.sha256.toLowerCase() !== actualSha.toLowerCase() ||
        existingObj.byteSize !== params.buffer.byteLength
      ) {
        return {
          status: 'conflict_mismatch',
          errorCode: 'IMMUTABLE_OBJECT_BYTE_CONFLICT'
        };
      }
      return { status: 'ok' };
    }

    this.privateStorageObjects.set(expectedPath, {
      storagePath: expectedPath,
      tenantId: params.tenantId,
      eventId: params.eventId,
      sessionId: params.sessionId,
      assetId: params.assetId,
      sha256: actualSha,
      byteSize: params.buffer.byteLength,
      mimeType: params.mimeType,
      bytes: Buffer.from(params.buffer),
      uploadedAt: params.nowIso ?? new Date().toISOString()
    });

    if (session.uploadState === 'registering') {
      session.uploadState = 'uploading';
    }

    return { status: 'ok' };
  }

  // --- API 4: Idempotent Session Finalization ---

  public finalizeSessionPublication(params: {
    actorUserId: string | null;
    idempotencyKey: string;
    tenantId: string;
    eventId: string;
    sessionId: string;
    manifest: ApprovedSessionManifest;
    nowIso?: string;
  }): {
    status: 'published' | 'rejected_incomplete' | 'rejected_expired' | 'unauthorized' | 'transient_error';
    publishedAt?: string;
    errorCode?: string;
  } {
    if (!params.actorUserId) {
      return { status: 'unauthorized', errorCode: 'UNAUTHENTICATED' };
    }

    const auth = this.verifyActorAuthorization({
      actorUserId: params.actorUserId,
      tenantId: params.tenantId,
      capability: 'capture_upload_reprint',
      eventId: params.eventId
    });
    if (!auth.authorized) {
      return { status: 'unauthorized', errorCode: auth.reason };
    }

    const session = this.sessions.get(params.sessionId);
    if (!session || session.tenantId !== params.tenantId) {
      return { status: 'unauthorized', errorCode: 'SESSION_NOT_FOUND' };
    }

    const nowIso = params.nowIso ?? new Date().toISOString();
    const nowMs = Date.parse(nowIso);

    // Transactionally prevent publication races with expiration or deletion (Section 6.6 & 8 / A10 / A11)
    if (
      Date.parse(session.expiresAt) <= nowMs ||
      session.deletionState !== 'not_due' ||
      session.uploadState === 'expired'
    ) {
      session.uploadState = 'expired';
      this.sweepObjectsForSession(session.sessionId);
      return {
        status: 'rejected_expired',
        errorCode: 'CANNOT_PUBLISH_EXPIRED_OR_DELETING_SESSION'
      };
    }

    // Idempotent return if already published (A06)
    if (session.uploadState === 'published' && session.publishedAt) {
      return {
        status: 'published',
        publishedAt: session.publishedAt
      };
    }

    // Verify ALL required manifest assets exist in private storage with matching SHA-256 and byteSize (A07)
    for (const asset of session.manifest.assets) {
      const expectedPath = computeScopedStoragePath({
        tenantId: session.tenantId,
        eventId: session.eventId,
        sessionId: session.sessionId,
        assetId: asset.assetId,
        extension: asset.mimeType === 'image/png' ? 'png' : 'jpg'
      });
      const stored = this.privateStorageObjects.get(expectedPath);
      if (
        !stored ||
        stored.sha256.toLowerCase() !== asset.sha256.toLowerCase() ||
        stored.byteSize !== asset.byteSize
      ) {
        return {
          status: 'rejected_incomplete',
          errorCode: `MISSING_OR_UNVERIFIED_ASSET:${asset.assetId}`
        };
      }
    }

    const hasComposite = session.manifest.assets.some((a) => a.kind === 'composite');
    const shotCount = session.manifest.assets.filter((a) => a.kind === 'shot').length;
    if (!hasComposite || shotCount < 1) {
      return {
        status: 'rejected_incomplete',
        errorCode: 'INCOMPLETE_MANIFEST_COMPOSITION'
      };
    }

    session.uploadState = 'published';
    session.publishedAt = nowIso;

    return {
      status: 'published',
      publishedAt: nowIso
    };
  }

  // --- API 5: Guest Token Gallery Lookup & Capped Per-Asset Download Authorization ---

  public lookupGalleryByToken(params: {
    rawToken: string;
    nowIso?: string;
    elapsedPollingSeconds?: number;
  }): GalleryLookupResponse {
    const nowIso = params.nowIso ?? new Date().toISOString();
    const nowMs = Date.parse(nowIso);

    if (this.simulateServiceOutage) {
      return {
        apiVersion: 'v1',
        state: 'temporarily_unavailable',
        customerNotice:
          'Gallery service is temporarily unavailable. Please wait a moment and try refreshing the page.',
        assets: []
      };
    }

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

    const sessionId = this.sessionsByTokenHash.get(tokenHash);
    if (!sessionId) {
      const tombstone = this.tombstoneByTokenHash.get(tokenHash);
      if (tombstone && Date.parse(tombstone.tombstoneRetainUntil) > nowMs) {
        return {
          apiVersion: 'v1',
          state: 'expired',
          expiresAt: tombstone.expiresAt,
          remainingSeconds: 0,
          customerNotice: formatCustomerExpirationNotice(tombstone.expiresAt),
          assets: []
        };
      }

      // Unknown token returns generic unavailable response — never false pending claim (Section 10.1 / A14)
      return {
        apiVersion: 'v1',
        state: 'unknown_unavailable',
        customerNotice: 'This gallery link is unavailable.',
        assets: []
      };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        apiVersion: 'v1',
        state: 'unknown_unavailable',
        customerNotice: 'This gallery link is unavailable.',
        assets: []
      };
    }

    // Immediate expiration enforcement on access, independent of cleanup worker success (Section 4 & 9.2 / A15 / A16)
    const expiresMs = Date.parse(session.expiresAt);
    if (
      nowMs >= expiresMs ||
      session.uploadState === 'expired' ||
      session.deletionState !== 'not_due'
    ) {
      return {
        apiVersion: 'v1',
        state: 'expired',
        expiresAt: session.expiresAt,
        remainingSeconds: 0,
        customerNotice: formatCustomerExpirationNotice(session.expiresAt),
        assets: []
      };
    }

    // Registered / Pending state: do NOT expose partial media before publication (A07)
    if (session.uploadState !== 'published') {
      const elapsedSec = params.elapsedPollingSeconds ?? 0;
      const pollIntervalMs = elapsedSec < 30 ? 5000 : 30000;
      return {
        apiVersion: 'v1',
        state: 'registered_pending',
        capturedAt: session.firstCapturedAt,
        expiresAt: session.expiresAt,
        remainingSeconds: Math.max(0, Math.floor((expiresMs - nowMs) / 1000)),
        pollIntervalMs: elapsedSec >= 600 ? undefined : pollIntervalMs,
        customerNotice: formatCustomerExpirationNotice(session.expiresAt),
        assets: []
      };
    }

    const event = this.events.get(session.eventId);
    const remainingSeconds = Math.max(0, Math.floor((expiresMs - nowMs) / 1000));

    return {
      apiVersion: 'v1',
      state: 'ready',
      eventDisplayName: event?.name ?? 'Photo Session',
      capturedAt: session.firstCapturedAt,
      expiresAt: session.expiresAt,
      remainingSeconds,
      customerNotice: formatCustomerExpirationNotice(session.expiresAt),
      assets: session.manifest.assets.map((asset) => ({
        assetId: asset.assetId,
        kind: asset.kind,
        shotIndex: asset.shotIndex,
        width: asset.width,
        height: asset.height,
        downloadEndpoint: `/api/v1/gallery/download?assetId=${asset.assetId}`
      }))
    };
  }

  public authorizeGuestAssetDownload(params: {
    rawToken: string;
    assetId: string;
    nowIso?: string;
  }): {
    authorized: boolean;
    ttlSeconds: number;
    signedDownloadUrl?: string;
    reason?: string;
  } {
    const lookup = this.lookupGalleryByToken({
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

    const tokenHash = hashGalleryToken(params.rawToken, this.tokenPepper);
    const sessionId = this.sessionsByTokenHash.get(tokenHash)!;
    const sig = crypto
      .createHmac('sha256', this.tokenPepper || 'odc-download-secret')
      .update(`${sessionId}:${params.assetId}:${ttlSeconds}`)
      .digest('base64url');

    return {
      authorized: true,
      ttlSeconds,
      signedDownloadUrl: `https://storage.odc-photostudio.internal/download/${sessionId}/${params.assetId}?ttl=${ttlSeconds}&sig=${sig}`
    };
  }

  // --- Anonymous Direct Session Table Listing Check (A13) ---

  public querySessionsDirect(params: {
    actorUserId: string | null;
    tenantId: string;
    eventId?: string;
  }): { allowed: boolean; sessions: CloudSessionRecord[]; reason?: string } {
    if (!params.actorUserId) {
      return {
        allowed: false,
        sessions: [],
        reason: 'ANONYMOUS_SESSION_LISTING_DENIED'
      };
    }

    const auth = this.verifyActorAuthorization({
      actorUserId: params.actorUserId,
      tenantId: params.tenantId,
      capability: 'browse_session_media',
      eventId: params.eventId
    });

    if (!auth.authorized) {
      return {
        allowed: false,
        sessions: [],
        reason: auth.reason ?? 'FORBIDDEN'
      };
    }

    const results = [...this.sessions.values()].filter(
      (s) =>
        s.tenantId === params.tenantId &&
        (!params.eventId || s.eventId === params.eventId)
    );
    return { allowed: true, sessions: results };
  }

  // --- API 6: Scheduled Deletion Worker & Overdue Alerting (Section 9.2 / A16) ---

  public runScheduledDeletionSweep(nowIso?: string): {
    enqueuedCount: number;
    deletedSessionsCount: number;
    failedCount: number;
    overdueAlertSessionIds: string[];
  } {
    const now = nowIso ?? new Date().toISOString();
    const nowMs = Date.parse(now);

    let enqueuedCount = 0;
    let deletedSessionsCount = 0;
    let failedCount = 0;
    const overdueAlertSessionIds: string[] = [];

    // 1. Identify all expired sessions not yet deleted
    for (const session of this.sessions.values()) {
      const expiresMs = Date.parse(session.expiresAt);
      if (expiresMs <= nowMs && session.deletionState !== 'deleted') {
        session.uploadState = 'expired';
        if (session.deletionState === 'not_due') {
          session.deletionState = 'due';
        }
        if (!this.deletionJobs.has(session.sessionId)) {
          this.deletionJobs.set(session.sessionId, {
            jobId: crypto.randomUUID(),
            tenantId: session.tenantId,
            sessionId: session.sessionId,
            deadline: new Date(expiresMs + 15 * 60 * 1000).toISOString(), // 15-min operational target
            attempts: 0,
            nextAttemptAt: now,
            status: 'pending',
            errorCode: null
          });
          enqueuedCount += 1;
        }
      }
    }

    // 2. Process due deletion jobs through Storage API
    for (const job of this.deletionJobs.values()) {
      if (job.status === 'completed') {
        continue;
      }
      const session = this.sessions.get(job.sessionId);
      if (!session) continue;

      if (Date.parse(job.nextAttemptAt) <= nowMs) {
        job.attempts += 1;
        session.deletionState = 'deleting';

        if (this.simulateStorageDeleteFailure) {
          session.deletionState = 'retry_scheduled';
          job.status = 'retry_scheduled';
          job.errorCode = 'STORAGE_API_DELETE_FAILED';
          job.nextAttemptAt = new Date(nowMs + 5 * 60 * 1000).toISOString();
          failedCount += 1;
        } else {
          this.sweepObjectsForSession(session.sessionId);
          session.deletionState = 'deleted';
          job.status = 'completed';
          job.errorCode = null;

          // Retain tombstone hash for 7 days to show expiration notice, then generic unavailable (Section 9.3)
          this.tombstoneByTokenHash.set(session.tokenHash, {
            expiresAt: session.expiresAt,
            tombstoneRetainUntil: new Date(
              Date.parse(session.expiresAt) + 7 * 24 * 60 * 60 * 1000
            ).toISOString()
          });
          this.sessionsByTokenHash.delete(session.tokenHash);
          deletedSessionsCount += 1;
        }
      }

      // Check 15-minute operational target for overdue deletion alerts (Section 9.2 / A16)
      if (job.status !== 'completed' && nowMs > Date.parse(job.deadline)) {
        overdueAlertSessionIds.push(job.sessionId);
      }
    }

    return {
      enqueuedCount,
      deletedSessionsCount,
      failedCount,
      overdueAlertSessionIds
    };
  }

  public requestEarlyDeletion(params: {
    actorUserId: string;
    tenantId: string;
    sessionId: string;
    nowIso?: string;
  }): { deleted: boolean; reason?: string } {
    const auth = this.verifyActorAuthorization({
      actorUserId: params.actorUserId,
      tenantId: params.tenantId,
      capability: 'request_early_deletion'
    });
    if (!auth.authorized) {
      return { deleted: false, reason: auth.reason };
    }

    const session = this.sessions.get(params.sessionId);
    if (!session || session.tenantId !== params.tenantId) {
      return { deleted: false, reason: 'SESSION_NOT_FOUND' };
    }

    const now = params.nowIso ?? new Date().toISOString();
    session.expiresAt = now;
    session.uploadState = 'expired';
    this.sweepObjectsForSession(session.sessionId);
    session.deletionState = 'deleted';
    this.sessionsByTokenHash.delete(session.tokenHash);
    return { deleted: true };
  }

  public getStoredObjectCountForSession(sessionId: string): number {
    let count = 0;
    for (const obj of this.privateStorageObjects.values()) {
      if (obj.sessionId === sessionId) {
        count += 1;
      }
    }
    return count;
  }

  private sweepObjectsForSession(sessionId: string): number {
    let removed = 0;
    for (const [key, obj] of this.privateStorageObjects.entries()) {
      if (obj.sessionId === sessionId) {
        this.privateStorageObjects.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}
