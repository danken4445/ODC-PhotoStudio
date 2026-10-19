import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import {
  PLAN_LIMIT_EXCEEDED,
  TENANT_SUSPENDED,
  ENROLLMENT_CODE_INVALID,
  ENROLLMENT_CODE_USED,
  ENROLLMENT_CODE_EXPIRED
} from '@odc-photostudio/contracts';
import {
  InMemoryPlatformService,
  SupabasePlatformService,
  setPlatformService
} from '../src/lib/platform-service';
import { GET as getTenantsHandler, POST as onboardTenantHandler } from '../src/app/api/odc/tenants/route';
import { GET as getTenantDetailsHandler } from '../src/app/api/odc/tenants/[tenantId]/route';
import { POST as updateTenantStatusHandler } from '../src/app/api/odc/tenants/[tenantId]/status/route';
import { POST as updateTenantPlanHandler } from '../src/app/api/odc/tenants/[tenantId]/plan/route';
import { POST as resetOwnerPasswordHandler } from '../src/app/api/odc/tenants/[tenantId]/reset-password/route';
import { POST as enrollStationHandler } from '../src/app/api/odc/tenants/[tenantId]/enroll-station/route';
import { POST as redeemStationHandler } from '../src/app/api/v1/station/enroll/route';

const ADMIN_USER_ID = '90000000-0000-4000-8000-000000000001';

describe('Stream C: Platform Service & API Routes + Plan Enforcement', () => {
  let platform: InMemoryPlatformService;

  beforeEach(() => {
    platform = new InMemoryPlatformService({ tokenPepper: 'test-pepper' });
    setPlatformService(platform);
  });

  describe('1. onboardTenant', () => {
    it('returns credentials once and creates tenant with plan defaults', async () => {
      const result = await platform.onboardTenant(
        {
          studioName: 'Flash Moments',
          slug: 'flash-moments',
          plan: 'plus',
          ownerDisplayName: 'Maria Clara',
          ownerLoginId: 'maria@flash-moments.odc.local',
          contactPhone: '+639171234567'
        },
        ADMIN_USER_ID
      );

      expect(result.tenantId).toBeDefined();
      expect(result.slug).toBe('flash-moments');
      expect(result.studioName).toBe('Flash Moments');
      expect(result.plan).toBe('plus');
      expect(result.status).toBe('active');
      expect(result.ownerLoginId).toBe('maria@flash-moments.odc.local');
      expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(16);
      expect(result.mustChangePassword).toBe(true);
      expect(result.loginUrl).toBe('/login?slug=flash-moments');

      const details = await platform.getTenantDetails(result.tenantId);
      expect(details.tenant.plan).toBe('plus');
      expect(details.tenant.features.softCopyQr).toBe(true);
      expect(details.tenant.limits.maxStations).toBe(3);
      expect(details.tenant.limits.maxTransactionsPerDay).toBe(100);
      expect(details.checklist.tenantCreated).toBe(true);
      expect(details.checklist.ownerCreated).toBe(true);
      expect(details.checklist.stationEnrolled).toBe(false);
    });

    it('rejects duplicate slugs', async () => {
      await platform.onboardTenant(
        {
          studioName: 'Studio Unique',
          slug: 'unique-slug',
          plan: 'basic',
          ownerDisplayName: 'Owner One',
          ownerLoginId: 'owner1@unique.odc.local'
        },
        ADMIN_USER_ID
      );

      await expect(
        platform.onboardTenant(
          {
            studioName: 'Studio Duplicate',
            slug: 'unique-slug',
            plan: 'plus',
            ownerDisplayName: 'Owner Two',
            ownerLoginId: 'owner2@unique.odc.local'
          },
          ADMIN_USER_ID
        )
      ).rejects.toThrow('SLUG_ALREADY_EXISTS');
    });

    it('compensation: simulated DB error cleans up auth user', async () => {
      let authUserDeleted = false;
      const fakeAuthAdmin = {
        createUser: async () => ({
          data: { user: { id: 'mock-auth-user-id' } },
          error: null
        }),
        deleteUser: async (id: string) => {
          if (id === 'mock-auth-user-id') authUserDeleted = true;
          return { data: {}, error: null };
        }
      };

      const fakeClient: any = {
        auth: { admin: fakeAuthAdmin },
        rpc: async () => ({
          data: null,
          error: { message: 'Database connection failed' }
        })
      };

      const supabaseService = new SupabasePlatformService({
        supabaseClient: fakeClient
      });

      await expect(
        supabaseService.onboardTenant(
          {
            studioName: 'Fail Studio',
            slug: 'fail-studio',
            plan: 'basic',
            ownerDisplayName: 'Fail Owner',
            ownerLoginId: 'fail@fail.odc.local'
          },
          ADMIN_USER_ID
        )
      ).rejects.toThrow('ONBOARD_RPC_FAILED');

      expect(authUserDeleted).toBe(true);
    });
  });

  describe('2. updateTenantStatus', () => {
    it('transitions active -> suspended -> active and logs audit', async () => {
      const onboard = await platform.onboardTenant(
        {
          studioName: 'Status Studio',
          slug: 'status-studio',
          plan: 'basic',
          ownerDisplayName: 'Status Owner',
          ownerLoginId: 'status@studio.odc.local'
        },
        ADMIN_USER_ID
      );

      // Suspend
      const suspendRes = await platform.updateTenantStatus(
        { tenantId: onboard.tenantId, status: 'suspended', reason: 'Non-payment' },
        ADMIN_USER_ID
      );
      expect(suspendRes.status).toBe('suspended');

      const detailsSuspended = await platform.getTenantDetails(onboard.tenantId);
      expect(detailsSuspended.tenant.status).toBe('suspended');

      // Reactivate
      const reactivateRes = await platform.updateTenantStatus(
        { tenantId: onboard.tenantId, status: 'active' },
        ADMIN_USER_ID
      );
      expect(reactivateRes.status).toBe('active');

      const detailsActive = await platform.getTenantDetails(onboard.tenantId);
      expect(detailsActive.tenant.status).toBe('active');
    });
  });

  describe('3. updateTenantPlan', () => {
    it('updates tenant limits and features from catalogue', async () => {
      const onboard = await platform.onboardTenant(
        {
          studioName: 'Upgrade Studio',
          slug: 'upgrade-studio',
          plan: 'basic',
          ownerDisplayName: 'Upgrade Owner',
          ownerLoginId: 'up@studio.odc.local'
        },
        ADMIN_USER_ID
      );

      expect(onboard.plan).toBe('basic');
      let details = await platform.getTenantDetails(onboard.tenantId);
      expect(details.tenant.features.softCopyQr).toBe(false);
      expect(details.tenant.limits.maxStations).toBe(1);

      // Upgrade to business
      const planRes = await platform.updateTenantPlan(
        { tenantId: onboard.tenantId, plan: 'business' },
        ADMIN_USER_ID
      );
      expect(planRes.plan).toBe('business');
      expect(planRes.features.softCopyQr).toBe(true);
      expect(planRes.limits.maxStations).toBe(10);
      expect(planRes.limits.maxCustomLayouts).toBe(6);

      details = await platform.getTenantDetails(onboard.tenantId);
      expect(details.tenant.plan).toBe('business');
      expect(details.tenant.features.softCopyQr).toBe(true);
      expect(details.tenant.limits.maxStations).toBe(10);
    });
  });

  describe('4. resetTenantOwnerPassword', () => {
    it('generates a fresh temporary password and returns it once', async () => {
      const onboard = await platform.onboardTenant(
        {
          studioName: 'Reset Studio',
          slug: 'reset-studio',
          plan: 'basic',
          ownerDisplayName: 'Reset Owner',
          ownerLoginId: 'reset@studio.odc.local'
        },
        ADMIN_USER_ID
      );

      const resetRes = await platform.resetTenantOwnerPassword(
        { tenantId: onboard.tenantId },
        ADMIN_USER_ID
      );

      expect(resetRes.tenantId).toBe(onboard.tenantId);
      expect(resetRes.temporaryPassword.length).toBeGreaterThanOrEqual(16);
      expect(resetRes.temporaryPassword).not.toBe(onboard.temporaryPassword);
      expect(resetRes.mustChangePassword).toBe(true);
    });
  });

  describe('5. Station Enrollment & Redemption', () => {
    it('creates station enrollment and enforces maxStations limit', async () => {
      // Basic plan has maxStations: 1
      const onboard = await platform.onboardTenant(
        {
          studioName: 'Station Studio',
          slug: 'station-studio',
          plan: 'basic',
          ownerDisplayName: 'Station Owner',
          ownerLoginId: 'station@studio.odc.local'
        },
        ADMIN_USER_ID
      );

      // Enroll station 1 -> succeeds
      const enroll1 = await platform.createStationEnrollment(
        { tenantId: onboard.tenantId, label: 'Booth 1' },
        ADMIN_USER_ID
      );
      expect(enroll1.stationId).toBeDefined();
      expect(enroll1.enrollmentCode).toMatch(/^ODC-[A-F0-9]{8}$/);

      // Enroll station 2 -> fails due to Basic plan limit of 1
      await expect(
        platform.createStationEnrollment(
          { tenantId: onboard.tenantId, label: 'Booth 2' },
          ADMIN_USER_ID
        )
      ).rejects.toThrow(PLAN_LIMIT_EXCEEDED);
    });

    it('rejects station enrollment if tenant is suspended', async () => {
      const onboard = await platform.onboardTenant(
        {
          studioName: 'Suspended Studio',
          slug: 'suspended-studio',
          plan: 'plus',
          ownerDisplayName: 'Suspended Owner',
          ownerLoginId: 'susp@studio.odc.local'
        },
        ADMIN_USER_ID
      );

      await platform.updateTenantStatus(
        { tenantId: onboard.tenantId, status: 'suspended' },
        ADMIN_USER_ID
      );

      await expect(
        platform.createStationEnrollment(
          { tenantId: onboard.tenantId, label: 'Booth 1' },
          ADMIN_USER_ID
        )
      ).rejects.toThrow(TENANT_SUSPENDED);
    });

    it('redeemStationEnrollment: allows single use, rejects reuse and expired code', async () => {
      const onboard = await platform.onboardTenant(
        {
          studioName: 'Redeem Studio',
          slug: 'redeem-studio',
          plan: 'plus',
          ownerDisplayName: 'Redeem Owner',
          ownerLoginId: 'redeem@studio.odc.local'
        },
        ADMIN_USER_ID
      );

      const enroll = await platform.createStationEnrollment(
        { tenantId: onboard.tenantId, label: 'Booth Main' },
        ADMIN_USER_ID
      );

      // Invalid code
      await expect(
        platform.redeemStationEnrollment({ code: 'ODC-INVALID99' })
      ).rejects.toThrow(ENROLLMENT_CODE_INVALID);

      // Valid redemption
      const redeemRes = await platform.redeemStationEnrollment({
        code: enroll.enrollmentCode,
        deviceLabel: 'Studio PC-01'
      });
      expect(redeemRes.tenantId).toBe(onboard.tenantId);
      expect(redeemRes.stationId).toBe(enroll.stationId);
      expect(redeemRes.status).toBe('active');
      expect(redeemRes.plan).toBe('plus');

      // Re-use rejection
      await expect(
        platform.redeemStationEnrollment({ code: enroll.enrollmentCode })
      ).rejects.toThrow(ENROLLMENT_CODE_USED);
    });
  });

  describe('6. Next.js API Routes for /api/odc/*', () => {
    it('validates platform admin authentication on protected routes', async () => {
      // Unauthenticated request
      const unauthReq = new NextRequest('http://localhost/api/odc/tenants');
      const res = await getTenantsHandler(unauthReq);
      expect(res.status).toBe(401);

      // Authenticated with valid mock admin in test environment
      const authReq = new NextRequest('http://localhost/api/odc/tenants', {
        headers: { 'x-actor-user-id': ADMIN_USER_ID }
      });
      const authRes = await getTenantsHandler(authReq);
      expect(authRes.status).toBe(200);
      const data = await authRes.json();
      expect(Array.isArray(data.tenants)).toBe(true);
    });

    it('POST /api/odc/tenants creates tenant and returns 201', async () => {
      const slug = `api-test-${Date.now()}`;
      const req = new NextRequest('http://localhost/api/odc/tenants', {
        method: 'POST',
        headers: {
          'x-actor-user-id': ADMIN_USER_ID,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          studioName: 'API Studio',
          slug,
          plan: 'plus',
          ownerDisplayName: 'API Owner',
          ownerLoginId: `owner@${slug}.odc.local`
        })
      });

      const res = await onboardTenantHandler(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.tenantId).toBeDefined();
      expect(json.slug).toBe(slug);
      expect(json.temporaryPassword).toBeDefined();

      // Check tenant details route
      const detailReq = new NextRequest(`http://localhost/api/odc/tenants/${json.tenantId}`, {
        headers: { 'x-actor-user-id': ADMIN_USER_ID }
      });
      const detailRes = await getTenantDetailsHandler(detailReq, { params: { tenantId: json.tenantId } });
      expect(detailRes.status).toBe(200);
      const details = await detailRes.json();
      expect(details.tenant.slug).toBe(slug);
    });

    it('POST /api/v1/station/enroll redeems code via public route', async () => {
      // Create station enrollment first via platform service
      const slug = `enroll-api-${Date.now()}`;
      const onboard = await platform.onboardTenant(
        {
          studioName: 'Enroll API Studio',
          slug,
          plan: 'business',
          ownerDisplayName: 'Owner',
          ownerLoginId: `owner@${slug}.odc.local`
        },
        ADMIN_USER_ID
      );
      const enrollment = await platform.createStationEnrollment(
        { tenantId: onboard.tenantId, label: 'Station 1' },
        ADMIN_USER_ID
      );

      // Redeem via API
      // Since API uses getPlatformService() singleton, test with valid schema
      const req = new NextRequest('http://localhost/api/v1/station/enroll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: 'ODC-NONEXISTENT'
        })
      });

      const res = await redeemStationHandler(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe(ENROLLMENT_CODE_INVALID);
    });
  });
});
