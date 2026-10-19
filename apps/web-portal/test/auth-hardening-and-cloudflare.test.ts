import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import {
  extractActorUserId,
  requirePlatformAdmin,
  AuthError
} from '../src/lib/api-auth';
import { GET as healthHandler } from '../src/app/api/v1/health/route';

describe('Stream B: Cloudflare Configuration & Auth Hardening', () => {
  const TEST_USER_ID = '11111111-2222-3333-4444-555555555555';
  const ADMIN_USER_ID = '99999999-8888-7777-6666-555555555555';
  const RAW_UUID_TOKEN = crypto.randomUUID();

  // Construct an unsigned mock JWT with payload containing `sub`
  const headerBase64 = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payloadBase64 = Buffer.from(
    JSON.stringify({ sub: TEST_USER_ID, exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString('base64url');
  const unsignedJwt = `${headerBase64}.${payloadBase64}.mocksignature`;

  describe('extractActorUserId in Test Mode (default)', () => {
    it('accepts x-actor-user-id header', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/test', {
        headers: { 'x-actor-user-id': TEST_USER_ID }
      });
      const actorId = await extractActorUserId(req);
      expect(actorId).toBe(TEST_USER_ID);
    });

    it('accepts x-operator-id header', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/test', {
        headers: { 'x-operator-id': TEST_USER_ID }
      });
      const actorId = await extractActorUserId(req);
      expect(actorId).toBe(TEST_USER_ID);
    });

    it('accepts raw UUID bearer tokens in test mode', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/test', {
        headers: { authorization: `Bearer ${RAW_UUID_TOKEN}` }
      });
      const actorId = await extractActorUserId(req);
      expect(actorId).toBe(RAW_UUID_TOKEN);
    });

    it('accepts unsigned JWT payload with sub in test mode fallback', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/test', {
        headers: { authorization: `Bearer ${unsignedJwt}` }
      });
      const actorId = await extractActorUserId(req);
      expect(actorId).toBe(TEST_USER_ID);
    });
  });

  describe('extractActorUserId in Simulated Production Mode (x-test-simulate-production: true)', () => {
    it('strictly rejects x-actor-user-id header', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/test', {
        headers: {
          'x-actor-user-id': TEST_USER_ID,
          'x-test-simulate-production': 'true'
        }
      });
      const actorId = await extractActorUserId(req);
      expect(actorId).toBeNull();
    });

    it('strictly rejects x-operator-id header', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/test', {
        headers: {
          'x-operator-id': TEST_USER_ID,
          'x-test-simulate-production': 'true'
        }
      });
      const actorId = await extractActorUserId(req);
      expect(actorId).toBeNull();
    });

    it('strictly rejects raw UUID bearer tokens in production mode', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/test', {
        headers: {
          authorization: `Bearer ${RAW_UUID_TOKEN}`,
          'x-test-simulate-production': 'true'
        }
      });
      const actorId = await extractActorUserId(req);
      expect(actorId).toBeNull();
    });

    it('strictly rejects unsigned JWT tokens in production mode', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/test', {
        headers: {
          authorization: `Bearer ${unsignedJwt}`,
          'x-test-simulate-production': 'true'
        }
      });
      const actorId = await extractActorUserId(req);
      expect(actorId).toBeNull();
    });

    it('accepts only verified tokens via Supabase Auth getUser in production mode', async () => {
      const verifiedToken = 'valid-production-jwt-token';
      const mockSupabaseClient = {
        auth: {
          getUser: async (token: string) => {
            if (token === verifiedToken) {
              return { data: { user: { id: TEST_USER_ID } }, error: null };
            }
            return { data: { user: null }, error: new Error('Invalid token') };
          }
        }
      } as any;

      const validReq = new NextRequest('http://localhost:3000/api/v1/test', {
        headers: {
          authorization: `Bearer ${verifiedToken}`,
          'x-test-simulate-production': 'true'
        }
      });
      const actorId = await extractActorUserId(validReq, { supabaseClient: mockSupabaseClient });
      expect(actorId).toBe(TEST_USER_ID);

      const invalidReq = new NextRequest('http://localhost:3000/api/v1/test', {
        headers: {
          authorization: 'Bearer bad-token',
          'x-test-simulate-production': 'true'
        }
      });
      const invalidActorId = await extractActorUserId(invalidReq, { supabaseClient: mockSupabaseClient });
      expect(invalidActorId).toBeNull();
    });
  });

  describe('requirePlatformAdmin', () => {
    it('throws 401 when request is unauthenticated', async () => {
      const req = new NextRequest('http://localhost:3000/api/odc/tenants');
      await expect(requirePlatformAdmin(req)).rejects.toThrowError(AuthError);
      await expect(requirePlatformAdmin(req)).rejects.toThrowError(/UNAUTHENTICATED/);
    });

    it('throws 403 when authenticated user is not a platform admin', async () => {
      const req = new NextRequest('http://localhost:3000/api/odc/tenants', {
        headers: { 'x-actor-user-id': TEST_USER_ID }
      });

      const isPlatformAdminCheck = async (userId: string) => userId === ADMIN_USER_ID;

      await expect(requirePlatformAdmin(req, isPlatformAdminCheck)).rejects.toThrowError(AuthError);
      await expect(requirePlatformAdmin(req, isPlatformAdminCheck)).rejects.toThrowError(/FORBIDDEN/);
    });

    it('returns actor user id when user is a confirmed platform admin', async () => {
      const req = new NextRequest('http://localhost:3000/api/odc/tenants', {
        headers: { 'x-actor-user-id': ADMIN_USER_ID }
      });

      const isPlatformAdminCheck = async (userId: string) => userId === ADMIN_USER_ID;

      const verifiedAdminId = await requirePlatformAdmin(req, isPlatformAdminCheck);
      expect(verifiedAdminId).toBe(ADMIN_USER_ID);
    });
  });

  describe('GET /api/v1/health (Cloudflare nodejs_compat spike)', () => {
    it('returns status ok, timestamp, and passes Ed25519 crypto verification', async () => {
      const res = await healthHandler();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
      expect(new Date(body.timestamp).getTime()).not.toBeNaN();
      expect(body.crypto).toEqual({
        engine: 'node:crypto',
        ed25519: 'ok'
      });
    });
  });
});
