import { describe, expect, it } from 'vitest';
import {
  PLAN_CATALOGUE,
  PlanDefinitionSchema,
  PlanTierSchema,
  getPlanDefinition,
  OnboardTenantInputSchema,
  OnboardTenantResultSchema,
  EnrollStationInputSchema,
  EnrollStationResultSchema,
  RedeemEnrollmentCodeInputSchema,
  RedeemEnrollmentCodeResultSchema,
  UpdateTenantStatusInputSchema,
  UpdateTenantPlanInputSchema,
  ResetOwnerPasswordInputSchema,
  ResetOwnerPasswordResultSchema,
  PLAN_LIMIT_EXCEEDED,
  TENANT_SUSPENDED,
  ENROLLMENT_CODE_INVALID,
  ENROLLMENT_CODE_EXPIRED,
  ENROLLMENT_CODE_USED,
  UNAUTHORIZED_NOT_PLATFORM_ADMIN,
  generateEd25519GrantKeyPair,
  signOfflineGrant,
  verifyOfflineGrant
} from '../src/index.js';

describe('Platform Contracts & Plan Catalogue', () => {
  describe('Plan Catalogue & Tiers (§3)', () => {
    it('validates all tiers exist in PlanTierSchema', () => {
      expect(PlanTierSchema.parse('basic')).toBe('basic');
      expect(PlanTierSchema.parse('plus')).toBe('plus');
      expect(PlanTierSchema.parse('business')).toBe('business');
      expect(() => PlanTierSchema.parse('enterprise')).toThrow();
    });

    it('conforms to exact §3 catalogue specifications', () => {
      // Basic
      const basic = getPlanDefinition('basic');
      expect(PlanDefinitionSchema.parse(basic)).toEqual(basic);
      expect(basic).toEqual({
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
      });

      // Plus
      const plus = getPlanDefinition('plus');
      expect(PlanDefinitionSchema.parse(plus)).toEqual(plus);
      expect(plus).toEqual({
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
      });

      // Business
      const business = getPlanDefinition('business');
      expect(PlanDefinitionSchema.parse(business)).toEqual(business);
      expect(business).toEqual({
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
      });
    });

    it('throws error for unknown plan tier in getPlanDefinition', () => {
      // @ts-expect-error testing invalid tier input
      expect(() => getPlanDefinition('unknown')).toThrow(/Unknown plan tier/);
    });
  });

  describe('Platform Onboarding Schemas & Constants', () => {
    it('validates OnboardTenantInputSchema', () => {
      const valid = {
        studioName: 'Flash Studio Manila',
        slug: 'flash-studio-mnl',
        plan: 'plus',
        ownerDisplayName: 'Juan Dela Cruz',
        ownerLoginId: 'juan@flashstudio.ph',
        contactPhone: '+639171234567',
        notes: 'Grand opening branch'
      };
      expect(OnboardTenantInputSchema.parse(valid)).toEqual(valid);

      // Invalid slug with uppercase or special characters
      expect(() =>
        OnboardTenantInputSchema.parse({
          ...valid,
          slug: 'Flash_Studio'
        })
      ).toThrow();

      // Invalid email
      expect(() =>
        OnboardTenantInputSchema.parse({
          ...valid,
          ownerLoginId: 'not-an-email'
        })
      ).toThrow();
    });

    it('validates OnboardTenantResultSchema', () => {
      const result = {
        tenantId: '10000000-0000-4000-8000-000000000001',
        slug: 'flash-studio',
        studioName: 'Flash Studio',
        plan: 'basic',
        status: 'active',
        ownerUserId: '40000000-0000-4000-8000-000000000001',
        ownerLoginId: 'owner@flash-studio.odc.local',
        temporaryPassword: 'temp-secret-password-1234',
        loginUrl: 'https://odc.example.com/login',
        mustChangePassword: true,
        createdAt: new Date().toISOString()
      };
      expect(OnboardTenantResultSchema.parse(result)).toEqual(result);
    });

    it('validates station enrollment and redemption schemas', () => {
      const enroll = EnrollStationInputSchema.parse({
        tenantId: '10000000-0000-4000-8000-000000000001',
        label: 'Booth Station Alpha'
      });
      expect(enroll.label).toBe('Booth Station Alpha');

      const enrollResult = EnrollStationResultSchema.parse({
        stationId: '30000000-0000-4000-8000-000000000001',
        enrollmentCode: 'ABCD-1234',
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      });
      expect(enrollResult.enrollmentCode).toBe('ABCD-1234');

      const redeem = RedeemEnrollmentCodeInputSchema.parse({
        code: 'ABCD-1234',
        deviceLabel: 'Dell Optiplex 7080'
      });
      expect(redeem.code).toBe('ABCD-1234');

      const redeemResult = RedeemEnrollmentCodeResultSchema.parse({
        tenantId: '10000000-0000-4000-8000-000000000001',
        stationId: '30000000-0000-4000-8000-000000000001',
        status: 'active',
        plan: 'plus'
      });
      expect(redeemResult.plan).toBe('plus');
    });

    it('validates tenant update and password reset schemas', () => {
      expect(
        UpdateTenantStatusInputSchema.parse({
          tenantId: '10000000-0000-4000-8000-000000000001',
          status: 'suspended',
          reason: 'Non-payment'
        }).status
      ).toBe('suspended');

      expect(
        UpdateTenantPlanInputSchema.parse({
          tenantId: '10000000-0000-4000-8000-000000000001',
          plan: 'business'
        }).plan
      ).toBe('business');

      const resetResult = ResetOwnerPasswordResultSchema.parse({
        tenantId: '10000000-0000-4000-8000-000000000001',
        ownerUserId: '40000000-0000-4000-8000-000000000001',
        ownerLoginId: 'owner@flash.odc.local',
        temporaryPassword: 'new-temp-password-5678',
        mustChangePassword: true
      });
      expect(resetResult.mustChangePassword).toBe(true);
    });

    it('exports all expected error code constants', () => {
      expect(PLAN_LIMIT_EXCEEDED).toBe('PLAN_LIMIT_EXCEEDED');
      expect(TENANT_SUSPENDED).toBe('TENANT_SUSPENDED');
      expect(ENROLLMENT_CODE_INVALID).toBe('ENROLLMENT_CODE_INVALID');
      expect(ENROLLMENT_CODE_EXPIRED).toBe('ENROLLMENT_CODE_EXPIRED');
      expect(ENROLLMENT_CODE_USED).toBe('ENROLLMENT_CODE_USED');
      expect(UNAUTHORIZED_NOT_PLATFORM_ADMIN).toBe('UNAUTHORIZED_NOT_PLATFORM_ADMIN');
    });
  });

  describe('Offline Grant with Plan Limits', () => {
    it('signs and verifies offline grant with plan limits embedded deterministically', () => {
      const { publicKeyPem, privateKeyPem } = generateEd25519GrantKeyPair();
      const payload = {
        grantId: '50000000-0000-4000-8000-000000000001',
        tenantId: '10000000-0000-4000-8000-000000000001',
        eventId: '20000000-0000-4000-8000-000000000001',
        stationId: '30000000-0000-4000-8000-000000000001',
        operatorId: '40000000-0000-4000-8000-000000000001',
        role: 'operator' as const,
        permittedTemplateVersionIds: ['60000000-0000-4000-8000-000000000001'],
        permittedPrintProfileIds: ['4x6-postcard'],
        galleryOrigin: 'https://gallery.odc.local',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        plan: 'plus' as const,
        maxTransactionsPerDay: 100,
        softCopyQr: true,
        maxCustomLayouts: 3
      };

      const signedGrant = signOfflineGrant(payload, privateKeyPem);
      expect(signedGrant.payload.plan).toBe('plus');
      expect(signedGrant.payload.maxTransactionsPerDay).toBe(100);
      expect(signedGrant.payload.softCopyQr).toBe(true);

      const verification = verifyOfflineGrant(signedGrant, publicKeyPem, {
        expectedTenantId: payload.tenantId,
        expectedStationId: payload.stationId
      });
      expect(verification.valid).toBe(true);

      // Signature fails if plan limit was tampered with
      const tamperedGrant = {
        ...signedGrant,
        payload: {
          ...signedGrant.payload,
          maxTransactionsPerDay: 999999
        }
      };
      const tamperedVerification = verifyOfflineGrant(tamperedGrant, publicKeyPem);
      expect(tamperedVerification.valid).toBe(false);
      expect(tamperedVerification.reason).toBe('INVALID_GRANT_SIGNATURE');
    });

    it('works seamlessly when optional plan fields are omitted (backwards compatibility)', () => {
      const { publicKeyPem, privateKeyPem } = generateEd25519GrantKeyPair();
      const legacyPayload = {
        grantId: '50000000-0000-4000-8000-000000000002',
        tenantId: '10000000-0000-4000-8000-000000000001',
        eventId: '20000000-0000-4000-8000-000000000001',
        stationId: '30000000-0000-4000-8000-000000000001',
        operatorId: '40000000-0000-4000-8000-000000000001',
        role: 'operator' as const,
        permittedTemplateVersionIds: ['60000000-0000-4000-8000-000000000001'],
        permittedPrintProfileIds: ['4x6-postcard'],
        galleryOrigin: 'https://gallery.odc.local',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      };

      const signedGrant = signOfflineGrant(legacyPayload, privateKeyPem);
      const verification = verifyOfflineGrant(signedGrant, publicKeyPem);
      expect(verification.valid).toBe(true);
      expect(signedGrant.payload.plan).toBeUndefined();
    });
  });
});
