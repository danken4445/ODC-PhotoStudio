import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as loginHandler } from '../src/app/api/odc/auth/login/route';
import { POST as logoutHandler } from '../src/app/api/odc/auth/logout/route';
import { GET as sessionHandler } from '../src/app/api/odc/auth/session/route';
import { GET as listTenantsHandler, POST as onboardTenantHandler } from '../src/app/api/odc/tenants/route';
import { GET as getTenantHandler } from '../src/app/api/odc/tenants/[tenantId]/route';
import { PATCH as updatePlanHandler } from '../src/app/api/odc/tenants/[tenantId]/plan/route';
import { PATCH as updateStatusHandler } from '../src/app/api/odc/tenants/[tenantId]/status/route';
import { POST as resetPasswordHandler } from '../src/app/api/odc/tenants/[tenantId]/reset-password/route';
import { POST as enrollStationHandler } from '../src/app/api/odc/tenants/[tenantId]/enroll-station/route';

describe('Stream E: ODC Super-Admin Web Portal & Client Onboarding (§1, §2, §5, §6)', () => {
  const ADMIN_USER_ID = '99999999-0000-4000-8000-000000000001';
  const NON_ADMIN_USER_ID = '11111111-0000-4000-8000-000000000001';

  const createAdminRequest = (url: string, init?: RequestInit): NextRequest => {
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${ADMIN_USER_ID}`);
    headers.set('x-actor-user-id', ADMIN_USER_ID);
    return new NextRequest(url, { ...init, headers });
  };

  const createNonAdminRequest = (url: string, init?: RequestInit): NextRequest => {
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${NON_ADMIN_USER_ID}`);
    headers.set('x-actor-user-id', NON_ADMIN_USER_ID);
    return new NextRequest(url, { ...init, headers });
  };

  describe('1. SuperAdmin Auth & Guard (§1 & §6)', () => {
    it('rejects login with missing email or password', async () => {
      const req = new NextRequest('http://localhost:3000/api/odc/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: '' })
      });
      const res = await loginHandler(req);
      expect(res.status).toBe(400);
    });

    it('rejects unauthorized login credentials', async () => {
      const req = new NextRequest('http://localhost:3000/api/odc/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'intruder@unknown.com', password: 'wrongpassword' })
      });
      const res = await loginHandler(req);
      expect(res.status).toBe(401);
    });

    it('authenticates platform admin and issues cookie', async () => {
      const req = new NextRequest('http://localhost:3000/api/odc/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'superadmin@odc.ph', password: 'SuperSecret2026!' })
      });
      const res = await loginHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.user.role).toBe('superadmin');

      const cookie = res.cookies.get('odc_admin_token');
      expect(cookie).toBeDefined();
    });

    it('logout clears odc_admin_token cookie', async () => {
      const res = await logoutHandler();
      expect(res.status).toBe(200);
      const cookie = res.cookies.get('odc_admin_token');
      expect(cookie?.value).toBe('');
    });

    it('session endpoint rejects unauthenticated caller', async () => {
      const req = new NextRequest('http://localhost:3000/api/odc/auth/session');
      const res = await sessionHandler(req);
      expect(res.status).toBe(401);
    });

    it('session endpoint verifies platform admin', async () => {
      const req = new NextRequest('http://localhost:3000/api/odc/auth/session', {
        headers: { authorization: `Bearer ${ADMIN_USER_ID}` }
      });
      const res = await sessionHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.isPlatformAdmin).toBe(true);
    });

    it('non-admin user gets 403 on protected endpoint', async () => {
      const req = createNonAdminRequest('http://localhost:3000/api/odc/tenants');
      const res = await listTenantsHandler(req);
      expect(res.status).toBe(403);
    });
  });

  describe('2. Client Onboarding & Tenant Provisioning (§2)', () => {
    let onboardedTenantId = '';
    const testSlug = `studio-test-${Date.now().toString(36)}`;

    it('lists existing tenants for platform admin', async () => {
      const req = createAdminRequest('http://localhost:3000/api/odc/tenants');
      const res = await listTenantsHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.tenants)).toBe(true);
    });

    it('onboards a new studio tenant and returns credentials once', async () => {
      const req = createAdminRequest('http://localhost:3000/api/odc/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          studioName: 'Flash & Frame Studio',
          slug: testSlug,
          plan: 'plus',
          ownerDisplayName: 'Bea Alonzo',
          ownerLoginId: `bea@${testSlug}.odc.local`,
          contactPhone: '+63 917 555 1234'
        })
      });

      const res = await onboardTenantHandler(req);
      expect(res.status).toBe(201);
      const json = await res.json();

      expect(json.slug).toBe(testSlug);
      expect(json.studioName).toBe('Flash & Frame Studio');
      expect(json.plan).toBe('plus');
      expect(json.status).toBe('active');
      expect(json.ownerLoginId).toBe(`bea@${testSlug}.odc.local`);
      expect(json.temporaryPassword).toBeDefined();
      expect(json.temporaryPassword.length).toBeGreaterThanOrEqual(12);
      expect(json.mustChangePassword).toBe(true);
      expect(json.loginUrl).toContain(testSlug);

      onboardedTenantId = json.tenantId;
    });

    it('rejects duplicate slug registration', async () => {
      const req = createAdminRequest('http://localhost:3000/api/odc/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          studioName: 'Duplicate Studio',
          slug: testSlug,
          plan: 'basic',
          ownerDisplayName: 'Copy Cat',
          ownerLoginId: 'copy@duplicate.odc.local'
        })
      });

      const res = await onboardTenantHandler(req);
      expect(res.status).toBe(409);
    });

    it('retrieves detailed tenant record with setup checklist', async () => {
      const req = createAdminRequest(`http://localhost:3000/api/odc/tenants/${onboardedTenantId}`);
      const res = await getTenantHandler(req, {
        params: Promise.resolve({ tenantId: onboardedTenantId })
      });
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.tenant.id).toBe(onboardedTenantId);
      expect(json.tenant.plan).toBe('plus');
      expect(json.checklist.tenantCreated).toBe(true);
      expect(json.checklist.ownerCreated).toBe(true);
      expect(json.checklist.ownerLoggedIn).toBe(false);
      expect(Array.isArray(json.stations)).toBe(true);
    });

    it('updates tenant subscription plan to business', async () => {
      const req = createAdminRequest(
        `http://localhost:3000/api/odc/tenants/${onboardedTenantId}/plan`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ plan: 'business' })
        }
      );
      const res = await updatePlanHandler(req, {
        params: Promise.resolve({ tenantId: onboardedTenantId })
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.plan).toBe('business');
    });

    it('suspends and reactivates tenant', async () => {
      // 1. Suspend
      const suspendReq = createAdminRequest(
        `http://localhost:3000/api/odc/tenants/${onboardedTenantId}/status`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'suspended' })
        }
      );
      const suspendRes = await updateStatusHandler(suspendReq, {
        params: Promise.resolve({ tenantId: onboardedTenantId })
      });
      expect(suspendRes.status).toBe(200);
      const suspendJson = await suspendRes.json();
      expect(suspendJson.status).toBe('suspended');

      // 2. Reactivate
      const reactivateReq = createAdminRequest(
        `http://localhost:3000/api/odc/tenants/${onboardedTenantId}/status`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'active' })
        }
      );
      const reactivateRes = await updateStatusHandler(reactivateReq, {
        params: Promise.resolve({ tenantId: onboardedTenantId })
      });
      expect(reactivateRes.status).toBe(200);
      const reactivateJson = await reactivateRes.json();
      expect(reactivateJson.status).toBe('active');
    });

    it('resets owner password and returns new temp credentials', async () => {
      const req = createAdminRequest(
        `http://localhost:3000/api/odc/tenants/${onboardedTenantId}/reset-password`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({})
        }
      );
      const res = await resetPasswordHandler(req, {
        params: Promise.resolve({ tenantId: onboardedTenantId })
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.temporaryPassword).toBeDefined();
      expect(json.temporaryPassword.length).toBeGreaterThanOrEqual(8);
      expect(json.mustChangePassword).toBe(true);
    });

    it('enrolls a new station and generates one-time enrollment code', async () => {
      const req = createAdminRequest(
        `http://localhost:3000/api/odc/tenants/${onboardedTenantId}/enroll-station`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: 'Booth 1 - Main Floor' })
        }
      );
      const res = await enrollStationHandler(req, {
        params: Promise.resolve({ tenantId: onboardedTenantId })
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.stationId).toBeDefined();
      expect(json.enrollmentCode).toBeDefined();
      expect(json.expiresAt).toBeDefined();
    });
  });
});
