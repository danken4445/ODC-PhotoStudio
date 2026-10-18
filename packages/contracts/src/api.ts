import { z } from 'zod';
import {
  CaptureStateSchema,
  CompositeStateSchema,
  DeletionStateSchema,
  PrintAttemptStateSchema,
  UploadStateSchema
} from './states.js';
import { PrintProfileSchema, TemplateDefinitionSchema } from './template.js';
import { SignedOfflineGrantSchema } from './security.js';

export const SESSION_RETENTION_HOURS = 24;
export const SESSION_RETENTION_MS = SESSION_RETENTION_HOURS * 60 * 60 * 1000;
export const MAX_DOWNLOAD_URL_TTL_SECONDS = 60;
export const MAX_CLOCK_DRIFT_MS = 5 * 60 * 1000; // 5 minutes threshold for clock jump warning

export function computeSessionExpirationIso(firstSuccessfulCaptureAtIso: string): string {
  const capturedMs = Date.parse(firstSuccessfulCaptureAtIso);
  if (Number.isNaN(capturedMs)) {
    throw new Error(`Invalid capture timestamp: ${firstSuccessfulCaptureAtIso}`);
  }
  return new Date(capturedMs + SESSION_RETENTION_MS).toISOString();
}

export function computeScopedStoragePath(params: {
  tenantId: string;
  eventId: string;
  sessionId: string;
  assetId: string;
  extension: 'jpg' | 'png';
}): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !uuidRegex.test(params.tenantId) ||
    !uuidRegex.test(params.eventId) ||
    !uuidRegex.test(params.sessionId) ||
    !uuidRegex.test(params.assetId)
  ) {
    throw new Error('All storage scope identifiers must be valid UUIDs');
  }
  return `${params.tenantId}/${params.eventId}/${params.sessionId}/${params.assetId}.${params.extension}`;
}

export function computeCappedDownloadTtlSeconds(expiresAtIso: string, nowIso?: string): number {
  const expiresMs = Date.parse(expiresAtIso);
  const nowMs = nowIso ? Date.parse(nowIso) : Date.now();
  const remainingSeconds = Math.floor((expiresMs - nowMs) / 1000);
  if (remainingSeconds <= 0) {
    return 0;
  }
  return Math.min(MAX_DOWNLOAD_URL_TTL_SECONDS, remainingSeconds);
}

export const SessionAssetKindSchema = z.enum(['shot', 'composite']);
export type SessionAssetKind = z.infer<typeof SessionAssetKindSchema>;

export const ManifestAssetSchema = z.object({
  assetId: z.string().uuid(),
  kind: SessionAssetKindSchema,
  shotIndex: z.number().int().min(0).nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  mimeType: z.enum(['image/jpeg', 'image/png'])
});
export type ManifestAsset = z.infer<typeof ManifestAssetSchema>;

export const ApprovedSessionManifestSchema = z.object({
  manifestVersion: z.literal(1),
  sessionId: z.string().uuid(),
  tenantId: z.string().uuid(),
  eventId: z.string().uuid(),
  stationId: z.string().uuid(),
  operatorId: z.string().uuid(),
  templateVersionId: z.string().uuid(),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/i),
  firstCapturedAt: z.string().datetime(),
  approvedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  assets: z.array(ManifestAssetSchema).min(2)
});
export type ApprovedSessionManifest = z.infer<typeof ApprovedSessionManifestSchema>;

// 1. Event Preparation & Offline Grant API Contract
export const PrepareEventRequestSchema = z.object({
  apiVersion: z.literal('v1'),
  tenantId: z.string().uuid(),
  eventId: z.string().uuid(),
  stationId: z.string().uuid(),
  deviceLabel: z.string().min(1).max(120)
});
export type PrepareEventRequest = z.infer<typeof PrepareEventRequestSchema>;

export const PrepareEventResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  serverTimeIso: z.string().datetime(),
  event: z.object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    name: z.string(),
    timezone: z.string(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    status: z.enum(['active', 'closed'])
  }),
  templates: z.array(
    z.object({
      templateVersionId: z.string().uuid(),
      templateId: z.string().uuid(),
      name: z.string(),
      version: z.number().int().positive(),
      definition: TemplateDefinitionSchema,
      overlayDownloadUrl: z.string().url()
    })
  ),
  printProfiles: z.array(PrintProfileSchema),
  offlineGrant: SignedOfflineGrantSchema
});
export type PrepareEventResponse = z.infer<typeof PrepareEventResponseSchema>;

// 2. Session Registration API Contract
export const RegisterSessionRequestSchema = z.object({
  apiVersion: z.literal('v1'),
  idempotencyKey: z.string().min(16).max(128),
  manifest: ApprovedSessionManifestSchema
});
export type RegisterSessionRequest = z.infer<typeof RegisterSessionRequestSchema>;

export const RegisterSessionResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  sessionId: z.string().uuid(),
  uploadState: UploadStateSchema,
  serverTimeIso: z.string().datetime(),
  objectTargets: z.array(
    z.object({
      assetId: z.string().uuid(),
      storagePath: z.string(),
      alreadyUploaded: z.boolean()
    })
  )
});
export type RegisterSessionResponse = z.infer<typeof RegisterSessionResponseSchema>;

// 3. Asset Upload Authorization Contract
export const AuthorizeAssetUploadRequestSchema = z.object({
  apiVersion: z.literal('v1'),
  tenantId: z.string().uuid(),
  eventId: z.string().uuid(),
  sessionId: z.string().uuid(),
  assetId: z.string().uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  byteSize: z.number().int().positive(),
  mimeType: z.enum(['image/jpeg', 'image/png'])
});
export type AuthorizeAssetUploadRequest = z.infer<typeof AuthorizeAssetUploadRequestSchema>;

export const AuthorizeAssetUploadResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  assetId: z.string().uuid(),
  storagePath: z.string(),
  uploadUrl: z.string().url(),
  expiresInSeconds: z.number().int().positive(),
  alreadyVerified: z.boolean()
});
export type AuthorizeAssetUploadResponse = z.infer<typeof AuthorizeAssetUploadResponseSchema>;

// 4. Session Finalization Contract
export const FinalizeSessionRequestSchema = z.object({
  apiVersion: z.literal('v1'),
  idempotencyKey: z.string().min(16).max(128),
  tenantId: z.string().uuid(),
  eventId: z.string().uuid(),
  sessionId: z.string().uuid(),
  manifestVersion: z.literal(1)
});
export type FinalizeSessionRequest = z.infer<typeof FinalizeSessionRequestSchema>;

export const FinalizeSessionResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  sessionId: z.string().uuid(),
  published: z.boolean(),
  publishedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  uploadState: UploadStateSchema
});
export type FinalizeSessionResponse = z.infer<typeof FinalizeSessionResponseSchema>;

// 5. Guest Gallery Lookup Contract (Section 10.1 states)
export const GalleryAvailabilityStateSchema = z.enum([
  'unknown_unavailable',
  'registered_pending',
  'ready',
  'temporarily_unavailable',
  'expired'
]);
export type GalleryAvailabilityState = z.infer<typeof GalleryAvailabilityStateSchema>;

export const GalleryAssetViewSchema = z.object({
  assetId: z.string().uuid(),
  kind: SessionAssetKindSchema,
  shotIndex: z.number().int().min(0).nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  downloadEndpoint: z.string()
});
export type GalleryAssetView = z.infer<typeof GalleryAssetViewSchema>;

export const GalleryLookupResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  state: GalleryAvailabilityStateSchema,
  eventDisplayName: z.string().optional(),
  capturedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  remainingSeconds: z.number().int().nonnegative().optional(),
  customerNotice: z.string(),
  pollIntervalMs: z.number().int().positive().optional(),
  assets: z.array(GalleryAssetViewSchema).default([])
});
export type GalleryLookupResponse = z.infer<typeof GalleryLookupResponseSchema>;

// 6. Administrative Early Deletion & Cleanup Contract
export const EarlyDeleteSessionRequestSchema = z.object({
  apiVersion: z.literal('v1'),
  tenantId: z.string().uuid(),
  sessionId: z.string().uuid(),
  reason: z.string().min(3).max(240)
});
export type EarlyDeleteSessionRequest = z.infer<typeof EarlyDeleteSessionRequestSchema>;

// 7. Authorization Matrix Enforcement (Section 10.2)
export const TenantRoleSchema = z.enum(['owner', 'admin', 'operator']);
export type TenantRole = z.infer<typeof TenantRoleSchema>;

export type Capability =
  | 'manage_tenant_ownership'
  | 'manage_operators_and_assignments'
  | 'manage_events_and_templates'
  | 'prepare_station_offline'
  | 'capture_upload_reprint'
  | 'browse_session_media'
  | 'request_early_deletion'
  | 'view_operational_analytics';

export function hasRoleCapability(
  role: TenantRole,
  capability: Capability,
  context: { isAssignedToEvent?: boolean } = {}
): boolean {
  switch (capability) {
    case 'manage_tenant_ownership':
      return role === 'owner';
    case 'manage_operators_and_assignments':
    case 'manage_events_and_templates':
    case 'request_early_deletion':
    case 'view_operational_analytics':
      return role === 'owner' || role === 'admin';
    case 'prepare_station_offline':
    case 'capture_upload_reprint':
    case 'browse_session_media':
      if (role === 'owner' || role === 'admin') {
        return true;
      }
      return Boolean(context.isAssignedToEvent);
  }
}

export const DurableJobTypeSchema = z.enum([
  'register_session',
  'upload_asset',
  'finalize_session'
]);
export type DurableJobType = z.infer<typeof DurableJobTypeSchema>;

export const DurableJobSchema = z.object({
  jobId: z.string().uuid(),
  jobType: DurableJobTypeSchema,
  sessionId: z.string().uuid(),
  tenantId: z.string().uuid(),
  eventId: z.string().uuid(),
  stationId: z.string().uuid(),
  idempotencyKey: z.string(),
  manifestVersion: z.number().int().positive(),
  state: UploadStateSchema,
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAt: z.string().datetime(),
  leaseOwner: z.string().nullable(),
  leaseExpiresAt: z.string().datetime().nullable(),
  errorCode: z.string().nullable(),
  diagnosticText: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type DurableJob = z.infer<typeof DurableJobSchema>;

export function computeExponentialBackoffMs(
  attemptCount: number,
  jitterRatio = 0.2
): number {
  const baseMs = 2000;
  const maxMs = 5 * 60 * 1000; // Capped at 5 minutes per Section 8
  const exp = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attemptCount - 1)));
  const jitter = exp * jitterRatio * (Math.random() * 2 - 1);
  return Math.max(1000, Math.min(maxMs, Math.round(exp + jitter)));
}

export {
  CaptureStateSchema,
  CompositeStateSchema,
  DeletionStateSchema,
  PrintAttemptStateSchema,
  UploadStateSchema
};
