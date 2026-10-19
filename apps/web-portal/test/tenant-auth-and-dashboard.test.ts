import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as loginHandler } from '../src/app/api/auth/login/route';
import { GET as sessionHandler } from '../src/app/api/auth/session/route';
import { POST as logoutHandler } from '../src/app/api/auth/logout/route';
import { POST as changePasswordHandler } from '../src/app/api/auth/change-password/route';
import { GET as dashboardHandler } from '../src/app/api/v1/tenant/dashboard/route';
import { POST as createEventHandler } from '../src/app/api/v1/tenant/events/route';
import { POST as enrollStationHandler } from '../src/app/api/v1/tenant/stations/enroll/route';
import { getPlatformService } from '../src/lib/platform-service';

describe('Tenant Authentication & Real Studio Dashboard APIs', () => {
  const platform = getPlatformService();

  it('rejects login with missing email or password', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '', password: '' })
    });
    const res = await loginHandler(req);
    expect(res.status).toBe(400);
  });

  it('rejects login with invalid credentials', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@odc.local', password: 'wrong' })
    });
    const res = await loginHandler(req);
    expect(res.status).toBe(401);
  });

  it('authenticates baseline Studio Alpha owner successfully', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'owner@studio-alpha.odc.local', password: 'password123' })
    });
    const res = await loginHandler(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user.email).toBe('owner@studio-alpha.odc.local');
    expect(body.user.role).toBe('owner');
    expect(body.user.tenant.slug).toBe('studio-alpha');

    // Cookie set
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('odc_tenant_token');
  });

  it('verifies session via GET /api/auth/session', async () => {
    const sessionReq = new NextRequest('http://localhost:3000/api/auth/session', {
      headers: {
        authorization: 'Bearer 40000000-0000-4000-8000-000000000099'
      }
    });
    const res = await sessionHandler(sessionReq);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.authenticated).toBe(true);
    expect(body.user.role).toBe('owner');
    expect(body.user.tenant.name).toBe('Studio Alpha');
  });

  it('allows owner to change permanent password', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer 40000000-0000-4000-8000-000000000099'
      },
      body: JSON.stringify({ newPassword: 'SuperSecretPermanent123!' })
    });
    const res = await changePasswordHandler(req);
    expect(res.status).toBe(200);

    // Verify login with new password
    const loginReq = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@studio-alpha.odc.local',
        password: 'SuperSecretPermanent123!'
      })
    });
    const loginRes = await loginHandler(loginReq);
    expect(loginRes.status).toBe(200);
  });

  it('fetches real dashboard data for active tenant', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/tenant/dashboard', {
      headers: {
        authorization: 'Bearer 40000000-0000-4000-8000-000000000099'
      }
    });
    const res = await dashboardHandler(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tenant.name).toBe('Studio Alpha');
    expect(body.events.length).toBeGreaterThanOrEqual(1);
    expect(body.templates.length).toBeGreaterThanOrEqual(1);
    expect(body.stations.length).toBeGreaterThanOrEqual(1);
    expect(body.storage.maxStorageMb).toBe(1024);
  });

  it('creates a new event via POST /api/v1/tenant/events', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/tenant/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer 40000000-0000-4000-8000-000000000099'
      },
      body: JSON.stringify({
        name: 'Summer Gala Extravaganza',
        timezone: 'Asia/Manila',
        startsAt: '2026-11-10T10:00:00Z',
        endsAt: '2026-11-10T18:00:00Z'
      })
    });
    const res = await createEventHandler(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.event.name).toBe('Summer Gala Extravaganza');
  });

  it('generates station enrollment code via POST /api/v1/tenant/stations/enroll', async () => {
    const req = new NextRequest('http://localhost:3000/api/v1/tenant/stations/enroll', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: 'Bearer 40000000-0000-4000-8000-000000000099'
      },
      body: JSON.stringify({
        label: 'Station Alpha-2 (Foyer Booth)'
      })
    });
    const res = await enrollStationHandler(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.enrollment.enrollmentCode).toMatch(/^ODC-[A-F0-9]{8}$/);
  });

  it('clears session on logout', async () => {
    const res = await logoutHandler();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('odc_tenant_token');
  });

  it('allows SupabasePlatformService to update password when user is in Supabase only', async () => {
    let updatedUserId: string | null = null;
    let updatedPassword: string | null = null;

    const mockSupabaseClient = {
      auth: {
        admin: {
          updateUserById: async (uid: string, attrs: any) => {
            updatedUserId = uid;
            updatedPassword = attrs.password;
            return { data: { user: { id: uid } }, error: null };
          }
        }
      }
    } as any;

    const svc = new (await import('../src/lib/platform-service')).SupabasePlatformService({
      supabaseClient: mockSupabaseClient
    });

    const nonExistentInMemoryUserId = 'supabase-only-user-id-999';
    await expect(
      svc.changeTenantUserPassword(nonExistentInMemoryUserId, 'BrandNewSecure123!')
    ).resolves.not.toThrow();

    expect(updatedUserId).toBe(nonExistentInMemoryUserId);
    expect(updatedPassword).toBe('BrandNewSecure123!');
  });
});

