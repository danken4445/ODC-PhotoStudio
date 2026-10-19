import crypto from 'node:crypto';
import { z } from 'zod';

export const GalleryTokenFormatSchema = z
  .string()
  .min(43)
  .max(44)
  .regex(/^[A-Za-z0-9_-]+$/, 'Gallery token must be base64url encoded');

export function generateSessionId(): string {
  return crypto.randomUUID();
}

export function generateGalleryToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashGalleryToken(token: string, serverPepper = ''): string {
  const validated = GalleryTokenFormatSchema.parse(token);
  return crypto
    .createHash('sha256')
    .update(serverPepper ? `${serverPepper}:${validated}` : validated, 'utf8')
    .digest('hex');
}

export function computeBufferSha256(buf: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function buildCanonicalGalleryUrl(galleryOrigin: string, token: string): string {
  const validated = GalleryTokenFormatSchema.parse(token);
  const cleanOrigin = galleryOrigin.replace(/\/+$/, '');
  if (!cleanOrigin.startsWith('https://') && !cleanOrigin.startsWith('http://localhost')) {
    throw new Error('Gallery origin must use HTTPS');
  }
  return `${cleanOrigin}/g/${validated}`;
}

export function redactTokensFromText(input: string): string {
  return input
    .replace(/(\/g\/)[A-Za-z0-9_-]{30,64}/g, '$1[REDACTED_GALLERY_TOKEN]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED_BEARER_TOKEN]');
}

export const OfflineGrantPayloadSchema = z.object({
  grantId: z.string().uuid(),
  tenantId: z.string().uuid(),
  eventId: z.string().uuid(),
  stationId: z.string().uuid(),
  operatorId: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'operator']),
  permittedTemplateVersionIds: z.array(z.string().uuid()).min(1),
  permittedPrintProfileIds: z.array(z.string().min(1)).min(1),
  galleryOrigin: z.string().url(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  plan: z.enum(['basic', 'plus', 'business']).optional(),
  maxTransactionsPerDay: z.number().int().positive().nullable().optional(),
  softCopyQr: z.boolean().optional(),
  maxCustomLayouts: z.number().int().nonnegative().optional()
});
export type OfflineGrantPayload = z.infer<typeof OfflineGrantPayloadSchema>;

export const SignedOfflineGrantSchema = z.object({
  payload: OfflineGrantPayloadSchema,
  signatureBase64Url: z.string().min(64)
});
export type SignedOfflineGrant = z.infer<typeof SignedOfflineGrantSchema>;

export const MAX_OFFLINE_GRANT_HOURS = 72;

export function generateEd25519GrantKeyPair(): {
  publicKeyPem: string;
  privateKeyPem: string;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

export function canonicalizeGrantPayload(payload: OfflineGrantPayload): string {
  const validated = OfflineGrantPayloadSchema.parse(payload);
  return JSON.stringify({
    grantId: validated.grantId,
    tenantId: validated.tenantId,
    eventId: validated.eventId,
    stationId: validated.stationId,
    operatorId: validated.operatorId,
    role: validated.role,
    permittedTemplateVersionIds: [...validated.permittedTemplateVersionIds].sort(),
    permittedPrintProfileIds: [...validated.permittedPrintProfileIds].sort(),
    galleryOrigin: validated.galleryOrigin,
    issuedAt: validated.issuedAt,
    expiresAt: validated.expiresAt,
    plan: validated.plan ?? null,
    maxTransactionsPerDay: validated.maxTransactionsPerDay ?? null,
    softCopyQr: validated.softCopyQr ?? null,
    maxCustomLayouts: validated.maxCustomLayouts ?? null
  });
}

export function signOfflineGrant(
  payload: OfflineGrantPayload,
  privateKeyPem: string
): SignedOfflineGrant {
  const validated = OfflineGrantPayloadSchema.parse(payload);
  const issuedMs = Date.parse(validated.issuedAt);
  const expiresMs = Date.parse(validated.expiresAt);
  const maxDurationMs = MAX_OFFLINE_GRANT_HOURS * 60 * 60 * 1000;

  if (expiresMs <= issuedMs) {
    throw new Error('Offline grant expiresAt must be after issuedAt');
  }
  if (expiresMs - issuedMs > maxDurationMs) {
    throw new Error(`Offline grant cannot exceed ${MAX_OFFLINE_GRANT_HOURS} hours`);
  }

  const canonical = canonicalizeGrantPayload(validated);
  const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKeyPem);
  return {
    payload: validated,
    signatureBase64Url: signature.toString('base64url')
  };
}

export function verifyOfflineGrant(
  grant: SignedOfflineGrant,
  publicKeyPem: string,
  context: {
    nowIso?: string;
    expectedTenantId?: string;
    expectedEventId?: string;
    expectedStationId?: string;
    expectedOperatorId?: string;
  } = {}
): { valid: boolean; reason?: string } {
  const parsed = SignedOfflineGrantSchema.safeParse(grant);
  if (!parsed.success) {
    return { valid: false, reason: 'INVALID_GRANT_SCHEMA' };
  }

  const { payload, signatureBase64Url } = parsed.data;
  const canonical = canonicalizeGrantPayload(payload);
  try {
    const isSigValid = crypto.verify(
      null,
      Buffer.from(canonical, 'utf8'),
      publicKeyPem,
      Buffer.from(signatureBase64Url, 'base64url')
    );
    if (!isSigValid) {
      return { valid: false, reason: 'INVALID_GRANT_SIGNATURE' };
    }
  } catch {
    return { valid: false, reason: 'SIGNATURE_VERIFICATION_ERROR' };
  }

  const issuedMs = Date.parse(payload.issuedAt);
  const expiresMs = Date.parse(payload.expiresAt);
  const maxDurationMs = MAX_OFFLINE_GRANT_HOURS * 60 * 60 * 1000;
  if (expiresMs - issuedMs > maxDurationMs) {
    return { valid: false, reason: 'GRANT_WINDOW_EXCEEDS_72_HOURS' };
  }

  const nowMs = context.nowIso ? Date.parse(context.nowIso) : Date.now();
  if (nowMs > expiresMs) {
    return { valid: false, reason: 'GRANT_EXPIRED' };
  }

  if (context.expectedTenantId && payload.tenantId !== context.expectedTenantId) {
    return { valid: false, reason: 'TENANT_MISMATCH' };
  }
  if (context.expectedEventId && payload.eventId !== context.expectedEventId) {
    return { valid: false, reason: 'EVENT_MISMATCH' };
  }
  if (context.expectedStationId && payload.stationId !== context.expectedStationId) {
    return { valid: false, reason: 'STATION_MISMATCH' };
  }
  if (context.expectedOperatorId && payload.operatorId !== context.expectedOperatorId) {
    return { valid: false, reason: 'OPERATOR_MISMATCH' };
  }

  return { valid: true };
}
