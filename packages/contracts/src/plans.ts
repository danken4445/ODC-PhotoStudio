import { z } from 'zod';

export const PlanTierSchema = z.enum(['basic', 'plus', 'business']);
export type PlanTier = z.infer<typeof PlanTierSchema>;

export const PlanDefinitionSchema = z.object({
  tier: PlanTierSchema,
  name: z.string().min(1),
  pricePhpMonthly: z.number().int().nonnegative(),
  maxTransactionsPerDay: z.number().int().positive().nullable(),
  maxCustomLayouts: z.number().int().nonnegative(),
  softCopyQr: z.boolean(),
  maxStorageMb: z.number().int().positive(),
  maxStations: z.number().int().positive(),
  maxActiveEvents: z.number().int().positive().nullable(),
  galleryRetentionHours: z.number().int().positive().nullable(),
  maxPortalMembers: z.number().int().positive()
});
export type PlanDefinition = z.infer<typeof PlanDefinitionSchema>;

export const PLAN_CATALOGUE: Record<PlanTier, PlanDefinition> = {
  basic: {
    tier: 'basic',
    name: 'Basic',
    pricePhpMonthly: 0,
    maxTransactionsPerDay: 50,
    maxCustomLayouts: 0,
    softCopyQr: false,
    maxStorageMb: 200,
    maxStations: 1,
    maxActiveEvents: 1,
    galleryRetentionHours: null,
    maxPortalMembers: 2
  },
  plus: {
    tier: 'plus',
    name: 'Plus',
    pricePhpMonthly: 999,
    maxTransactionsPerDay: 100,
    maxCustomLayouts: 3,
    softCopyQr: true,
    maxStorageMb: 1024,
    maxStations: 3,
    maxActiveEvents: 5,
    galleryRetentionHours: 24,
    maxPortalMembers: 10
  },
  business: {
    tier: 'business',
    name: 'Business',
    pricePhpMonthly: 1999,
    maxTransactionsPerDay: null,
    maxCustomLayouts: 6,
    softCopyQr: true,
    maxStorageMb: 2048,
    maxStations: 10,
    maxActiveEvents: null,
    galleryRetentionHours: 24,
    maxPortalMembers: 50
  }
};

export function getPlanDefinition(tier: PlanTier): PlanDefinition {
  const plan = PLAN_CATALOGUE[tier];
  if (!plan) {
    throw new Error(`Unknown plan tier: ${tier}`);
  }
  return plan;
}
