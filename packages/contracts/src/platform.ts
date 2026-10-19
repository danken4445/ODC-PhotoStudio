import { z } from 'zod';
import { PlanTierSchema } from './plans.js';

export const TenantPlanSchema = PlanTierSchema;
export type TenantPlan = z.infer<typeof TenantPlanSchema>;

export const TenantStatusSchema = z.enum(['active', 'suspended', 'closed']);
export type TenantStatus = z.infer<typeof TenantStatusSchema>;

export const TenantSlugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9-]+$/, 'Slug must only contain lowercase alphanumeric characters and hyphens');

export const OnboardTenantInputSchema = z.object({
  studioName: z.string().min(2).max(120),
  slug: TenantSlugSchema,
  plan: TenantPlanSchema,
  ownerDisplayName: z.string().min(1).max(120),
  ownerLoginId: z.string().email(),
  contactPhone: z.string().max(40).optional(),
  notes: z.string().max(1000).optional()
});
export type OnboardTenantInput = z.infer<typeof OnboardTenantInputSchema>;

export const OnboardTenantResultSchema = z.object({
  tenantId: z.string().uuid(),
  slug: z.string(),
  studioName: z.string(),
  plan: TenantPlanSchema,
  status: TenantStatusSchema,
  ownerUserId: z.string().uuid(),
  ownerLoginId: z.string(),
  temporaryPassword: z.string().min(8),
  loginUrl: z.string(),
  mustChangePassword: z.boolean(),
  createdAt: z.string().datetime()
});
export type OnboardTenantResult = z.infer<typeof OnboardTenantResultSchema>;

export const EnrollStationInputSchema = z.object({
  tenantId: z.string().uuid(),
  label: z.string().min(1).max(120)
});
export type EnrollStationInput = z.infer<typeof EnrollStationInputSchema>;

export const EnrollStationResultSchema = z.object({
  stationId: z.string().uuid(),
  enrollmentCode: z.string().min(6),
  expiresAt: z.string().datetime()
});
export type EnrollStationResult = z.infer<typeof EnrollStationResultSchema>;

export const RedeemEnrollmentCodeInputSchema = z.object({
  code: z.string().min(6),
  deviceLabel: z.string().min(1).max(120).optional()
});
export type RedeemEnrollmentCodeInput = z.infer<typeof RedeemEnrollmentCodeInputSchema>;

export const RedeemEnrollmentCodeResultSchema = z.object({
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
  status: z.enum(['active', 'revoked', 'maintenance']),
  plan: TenantPlanSchema
});
export type RedeemEnrollmentCodeResult = z.infer<typeof RedeemEnrollmentCodeResultSchema>;

export const UpdateTenantStatusInputSchema = z.object({
  tenantId: z.string().uuid(),
  status: TenantStatusSchema,
  reason: z.string().max(500).optional()
});
export type UpdateTenantStatusInput = z.infer<typeof UpdateTenantStatusInputSchema>;

export const UpdateTenantPlanInputSchema = z.object({
  tenantId: z.string().uuid(),
  plan: TenantPlanSchema
});
export type UpdateTenantPlanInput = z.infer<typeof UpdateTenantPlanInputSchema>;

export const ResetOwnerPasswordInputSchema = z.object({
  tenantId: z.string().uuid(),
  ownerUserId: z.string().uuid().optional()
});
export type ResetOwnerPasswordInput = z.infer<typeof ResetOwnerPasswordInputSchema>;

export const ResetOwnerPasswordResultSchema = z.object({
  tenantId: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  ownerLoginId: z.string(),
  temporaryPassword: z.string().min(8),
  mustChangePassword: z.boolean()
});
export type ResetOwnerPasswordResult = z.infer<typeof ResetOwnerPasswordResultSchema>;

// Error constants
export const PLAN_LIMIT_EXCEEDED = 'PLAN_LIMIT_EXCEEDED';
export const TENANT_SUSPENDED = 'TENANT_SUSPENDED';
export const ENROLLMENT_CODE_INVALID = 'ENROLLMENT_CODE_INVALID';
export const ENROLLMENT_CODE_EXPIRED = 'ENROLLMENT_CODE_EXPIRED';
export const ENROLLMENT_CODE_USED = 'ENROLLMENT_CODE_USED';
export const UNAUTHORIZED_NOT_PLATFORM_ADMIN = 'UNAUTHORIZED_NOT_PLATFORM_ADMIN';
