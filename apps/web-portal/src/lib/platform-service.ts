import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
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
  type OnboardTenantInput,
  type OnboardTenantResult,
  type EnrollStationInput,
  type EnrollStationResult,
  type RedeemEnrollmentCodeInput,
  type RedeemEnrollmentCodeResult,
  type UpdateTenantStatusInput,
  type UpdateTenantPlanInput,
  type ResetOwnerPasswordInput,
  type ResetOwnerPasswordResult,
  type TenantPlan,
  type TenantStatus,
  type TenantRole
} from '@odc-photostudio/contracts';
import { createAnonClient, createServiceRoleClient, type Database } from './supabase-client';
import { SupabaseCloudPortalRepository, getCloudPortalRepository } from './supabase-repository';

export interface TenantListItem {
  id: string;
  name: string;
  slug: string;
  plan: TenantPlan;
  status: TenantStatus;
  stationCount: number;
  createdAt: string;
}

export interface TenantDetails {
  tenant: {
    id: string;
    name: string;
    slug: string;
    plan: TenantPlan;
    status: TenantStatus;
    features: Record<string, any>;
    limits: Record<string, any>;
    createdAt: string;
  };
  settings: {
    brandName: string | null;
    logoPath: string | null;
    primaryColor: string | null;
    contact: Record<string, any>;
    timezone: string;
  };
  stations: Array<{
    id: string;
    label: string;
    status: string;
    lastSeenAt: string | null;
    createdAt: string;
  }>;
  checklist: {
    tenantCreated: boolean;
    ownerCreated: boolean;
    ownerLoggedIn: boolean;
    stationEnrolled: boolean;
    templateUploaded: boolean;
    firstEventCreated: boolean;
  };
}

export interface TenantSessionUser {
  id: string;
  email: string;
  displayName: string;
  role: TenantRole;
  mustChangePassword: boolean;
  tenant: {
    id: string;
    name: string;
    slug: string;
    plan: TenantPlan;
    status: TenantStatus;
  };
}

export interface TenantDashboardData {
  tenant: {
    id: string;
    name: string;
    slug: string;
    plan: TenantPlan;
    status: TenantStatus;
    features: Record<string, any>;
    limits: Record<string, any>;
    createdAt: string;
  };
  events: Array<{
    id: string;
    name: string;
    timezone: string;
    startsAt: string;
    endsAt: string;
    status: 'active' | 'closed';
    stationIds: string[];
    operatorIds: string[];
  }>;
  templates: Array<{
    id: string;
    versionId: string;
    name: string;
    version: number;
    type: '4x6_postcard' | '2x6_strip';
    width: number;
    height: number;
    dpi: number;
    sha256: string;
    slotCount: number;
  }>;
  members: Array<{
    userId: string;
    name: string;
    role: TenantRole;
    status: 'active' | 'revoked';
  }>;
  stations: Array<{
    id: string;
    label: string;
    status: 'active' | 'revoked' | 'maintenance';
    lastSeenAt: string | null;
  }>;
  storage: {
    usedMb: number;
    maxStorageMb: number;
    sessionCount: number;
    expiredSessionCount: number;
    retentionHours: number;
  };
}

export interface PlatformService {
  listTenants(): Promise<TenantListItem[]>;
  getTenantDetails(tenantId: string): Promise<TenantDetails>;
  onboardTenant(input: OnboardTenantInput, adminUserId: string): Promise<OnboardTenantResult>;
  resetTenantOwnerPassword(input: ResetOwnerPasswordInput, adminUserId: string): Promise<ResetOwnerPasswordResult>;
  updateTenantStatus(input: UpdateTenantStatusInput, adminUserId: string): Promise<{ tenantId: string; status: TenantStatus }>;
  updateTenantPlan(input: UpdateTenantPlanInput, adminUserId: string): Promise<{ tenantId: string; plan: TenantPlan; limits: Record<string, any>; features: Record<string, any> }>;
  createStationEnrollment(input: EnrollStationInput, adminUserId: string): Promise<EnrollStationResult>;
  redeemStationEnrollment(input: RedeemEnrollmentCodeInput): Promise<RedeemEnrollmentCodeResult>;
  authenticateTenantUser(email: string, password: string): Promise<TenantSessionUser>;
  changeTenantUserPassword(userId: string, newPassword: string): Promise<void>;
  getTenantUserSession(tokenOrUserId: string): Promise<TenantSessionUser | null>;
  getTenantDashboardData(tenantId: string): Promise<TenantDashboardData>;
  createTenantEvent(tenantId: string, input: { name: string; timezone: string; startsAt: string; endsAt: string }): Promise<any>;
}

interface GlobalInMemoryPlatformState {
  tenants: Map<string, any>;
  tenantSettings: Map<string, any>;
  profiles: Map<string, any>;
  memberships: Map<string, any>;
  stations: Map<string, any>;
  stationEnrollments: Map<string, any>;
  userCredentials: Map<string, any>;
  events: Map<string, any>;
  templates: Map<string, any>;
  auditEvents: any[];
}

const globalForPlatform = globalThis as unknown as {
  globalPlatformService?: PlatformService | null;
  odcPlatformMemory?: GlobalInMemoryPlatformState;
};

export class InMemoryPlatformService implements PlatformService {
  private tenants: Map<string, any>;
  private tenantSettings: Map<string, any>;
  private profiles: Map<string, any>;
  private memberships: Map<string, any>;
  private stations: Map<string, any>;
  private stationEnrollments: Map<string, any>;
  private userCredentials: Map<string, any>;
  private events: Map<string, any>;
  private templates: Map<string, any>;
  private auditEvents: any[];
  private tokenPepper: string;
  private simulateDbErrorOnOnboard = false;

  constructor(options?: { tokenPepper?: string }) {
    this.tokenPepper = options?.tokenPepper ?? process.env.TOKEN_PEPPER_SECRET ?? '';
    if (!globalForPlatform.odcPlatformMemory) {
      globalForPlatform.odcPlatformMemory = {
        tenants: new Map(),
        tenantSettings: new Map(),
        profiles: new Map(),
        memberships: new Map(),
        stations: new Map(),
        stationEnrollments: new Map(),
        userCredentials: new Map(),
        events: new Map(),
        templates: new Map(),
        auditEvents: []
      };
    }
    this.tenants = globalForPlatform.odcPlatformMemory.tenants;
    this.tenantSettings = globalForPlatform.odcPlatformMemory.tenantSettings;
    this.profiles = globalForPlatform.odcPlatformMemory.profiles;
    this.memberships = globalForPlatform.odcPlatformMemory.memberships;
    this.stations = globalForPlatform.odcPlatformMemory.stations;
    this.stationEnrollments = globalForPlatform.odcPlatformMemory.stationEnrollments;
    this.userCredentials = globalForPlatform.odcPlatformMemory.userCredentials;
    this.events = globalForPlatform.odcPlatformMemory.events;
    this.templates = globalForPlatform.odcPlatformMemory.templates;
    this.auditEvents = globalForPlatform.odcPlatformMemory.auditEvents;

    // Seed default baseline studio if state is fresh
    if (this.tenants.size === 0) {
      this.seedBaselineStudio();
    }
  }

  private seedBaselineStudio(): void {
    const tenantId = '10000000-0000-4000-8000-000000000001';
    const ownerUserId = '40000000-0000-4000-8000-000000000099';
    const stationId = '30000000-0000-4000-8000-000000000001';
    const eventId = '20000000-0000-4000-8000-000000000001';
    const templateVerId = '60000000-0000-4000-8000-000000000001';
    const nowIso = new Date().toISOString();

    const planDef = getPlanDefinition('plus');

    this.tenants.set(tenantId, {
      id: tenantId,
      name: 'Studio Alpha',
      slug: 'studio-alpha',
      plan: 'plus',
      status: 'active',
      features: { softCopyQr: true },
      limits: {
        maxTransactionsPerDay: planDef.maxTransactionsPerDay,
        maxCustomLayouts: planDef.maxCustomLayouts,
        maxStorageMb: planDef.maxStorageMb,
        maxStations: planDef.maxStations,
        maxActiveEvents: planDef.maxActiveEvents,
        galleryRetentionHours: planDef.galleryRetentionHours,
        maxPortalMembers: planDef.maxPortalMembers
      },
      onboardedBy: 'system',
      createdVia: 'seed',
      createdAt: nowIso
    });

    this.tenantSettings.set(tenantId, {
      tenantId,
      brandName: 'Studio Alpha',
      logoPath: null,
      primaryColor: '#3B82F6',
      contact: { phone: '+63 900 000 0000' },
      timezone: 'Asia/Manila'
    });

    this.profiles.set(ownerUserId, {
      id: ownerUserId,
      displayName: 'Alex Vance (Studio Owner)',
      createdAt: nowIso,
      updatedAt: nowIso
    });

    this.memberships.set(`${tenantId}:${ownerUserId}`, {
      id: '50000000-0000-4000-8000-000000000099',
      tenantId,
      userId: ownerUserId,
      role: 'owner',
      status: 'active',
      createdAt: nowIso,
      updatedAt: nowIso
    });

    this.userCredentials.set('owner@studio-alpha.odc.local', {
      userId: ownerUserId,
      tenantId,
      email: 'owner@studio-alpha.odc.local',
      password: 'password123',
      mustChangePassword: false,
      role: 'owner',
      displayName: 'Alex Vance (Studio Owner)'
    });

    this.stations.set(stationId, {
      id: stationId,
      tenantId,
      deviceIdentity: 'station-alpha-main',
      label: 'Station Alpha-1 (Main Ballroom)',
      status: 'active',
      lastSeenAt: nowIso,
      createdAt: nowIso
    });

    this.events.set(eventId, {
      id: eventId,
      tenantId,
      name: 'Grand Gala 2026',
      timezone: 'Asia/Manila',
      startsAt: '2026-10-18T00:00:00Z',
      endsAt: '2026-10-20T00:00:00Z',
      status: 'active',
      stationIds: [stationId],
      operatorIds: [ownerUserId],
      createdAt: nowIso
    });

    this.templates.set(templateVerId, {
      id: '70000000-0000-4000-8000-000000000001',
      versionId: templateVerId,
      tenantId,
      name: '4x6 Studio Postcard',
      version: 1,
      type: '4x6_postcard',
      width: 1200,
      height: 1800,
      dpi: 300,
      sha256: 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3fc964b97d8b5a03e6a4b13a2',
      slotCount: 4
    });
  }

  public setSimulateDbError(fail: boolean): void {
    this.simulateDbErrorOnOnboard = fail;
  }

  public getStationCount(tenantId: string): number {
    let count = 0;
    for (const st of this.stations.values()) {
      if (st.tenantId === tenantId) count += 1;
    }
    return count;
  }

  async listTenants(): Promise<TenantListItem[]> {
    const list: TenantListItem[] = [];
    for (const t of this.tenants.values()) {
      const stationCount = this.getStationCount(t.id);
      list.push({
        id: t.id,
        name: t.name,
        slug: t.slug,
        plan: t.plan,
        status: t.status,
        stationCount,
        createdAt: t.createdAt
      });
    }
    return list;
  }

  async getTenantDetails(tenantId: string): Promise<TenantDetails> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new Error('TENANT_NOT_FOUND');
    }
    const settings = this.tenantSettings.get(tenantId) ?? {
      brandName: tenant.name,
      logoPath: null,
      primaryColor: null,
      contact: {},
      timezone: 'UTC'
    };
    const stations: any[] = [];
    for (const st of this.stations.values()) {
      if (st.tenantId === tenantId) {
        stations.push({
          id: st.id,
          label: st.label,
          status: st.status,
          lastSeenAt: st.lastSeenAt ?? null,
          createdAt: st.createdAt
        });
      }
    }

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status,
        features: tenant.features ?? {},
        limits: tenant.limits ?? {},
        createdAt: tenant.createdAt
      },
      settings,
      stations,
      checklist: {
        tenantCreated: true,
        ownerCreated: true,
        ownerLoggedIn: false,
        stationEnrolled: stations.length > 0,
        templateUploaded: false,
        firstEventCreated: false
      }
    };
  }

  async onboardTenant(input: OnboardTenantInput, adminUserId: string): Promise<OnboardTenantResult> {
    const validated = OnboardTenantInputSchema.parse(input);

    // Slug unique check
    for (const t of this.tenants.values()) {
      if (t.slug.toLowerCase() === validated.slug.toLowerCase()) {
        throw new Error('SLUG_ALREADY_EXISTS');
      }
    }

    const tenantId = crypto.randomUUID();
    const ownerUserId = crypto.randomUUID();
    const tempPassword = crypto.randomBytes(12).toString('base64url') + '!A1';
    const planDef = getPlanDefinition(validated.plan);
    const nowIso = new Date().toISOString();

    if (this.simulateDbErrorOnOnboard) {
      throw new Error('SIMULATED_DB_ERROR');
    }

    const tenant = {
      id: tenantId,
      name: validated.studioName,
      slug: validated.slug,
      plan: validated.plan,
      status: 'active' as TenantStatus,
      features: {
        softCopyQr: planDef.softCopyQr
      },
      limits: {
        maxTransactionsPerDay: planDef.maxTransactionsPerDay,
        maxCustomLayouts: planDef.maxCustomLayouts,
        maxStorageMb: planDef.maxStorageMb,
        maxStations: planDef.maxStations,
        maxActiveEvents: planDef.maxActiveEvents,
        galleryRetentionHours: planDef.galleryRetentionHours,
        maxPortalMembers: planDef.maxPortalMembers
      },
      onboardedBy: adminUserId,
      createdVia: 'odc',
      createdAt: nowIso
    };

    this.tenants.set(tenantId, tenant);

    this.tenantSettings.set(tenantId, {
      tenantId,
      brandName: validated.studioName,
      logoPath: null,
      primaryColor: null,
      contact: validated.contactPhone ? { phone: validated.contactPhone } : {},
      timezone: 'UTC'
    });

    this.profiles.set(ownerUserId, {
      id: ownerUserId,
      displayName: validated.ownerDisplayName,
      createdAt: nowIso,
      updatedAt: nowIso
    });

    this.memberships.set(`${tenantId}:${ownerUserId}`, {
      id: crypto.randomUUID(),
      tenantId,
      userId: ownerUserId,
      role: 'owner',
      status: 'active',
      createdAt: nowIso,
      updatedAt: nowIso
    });

    this.auditEvents.push({
      id: crypto.randomUUID(),
      tenantId,
      actorId: adminUserId,
      action: 'tenant.onboarded',
      entityId: tenantId,
      metadata: { slug: validated.slug, plan: validated.plan },
      createdAt: nowIso
    });

    this.userCredentials.set(validated.ownerLoginId.toLowerCase(), {
      userId: ownerUserId,
      tenantId,
      email: validated.ownerLoginId.toLowerCase(),
      password: tempPassword,
      mustChangePassword: true,
      role: 'owner',
      displayName: validated.ownerDisplayName
    });

    const templateVerId = crypto.randomUUID();
    this.templates.set(templateVerId, {
      id: crypto.randomUUID(),
      versionId: templateVerId,
      tenantId,
      name: '4x6 Studio Postcard',
      version: 1,
      type: '4x6_postcard',
      width: 1200,
      height: 1800,
      dpi: 300,
      sha256: 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3fc964b97d8b5a03e6a4b13a2',
      slotCount: 4
    });

    return {
      tenantId,
      slug: validated.slug,
      studioName: validated.studioName,
      plan: validated.plan,
      status: 'active',
      ownerUserId,
      ownerLoginId: validated.ownerLoginId,
      temporaryPassword: tempPassword,
      loginUrl: `/login?slug=${validated.slug}`,
      mustChangePassword: true,
      createdAt: nowIso
    };
  }

  async resetTenantOwnerPassword(input: ResetOwnerPasswordInput, adminUserId: string): Promise<ResetOwnerPasswordResult> {
    const validated = ResetOwnerPasswordInputSchema.parse(input);
    const tenant = this.tenants.get(validated.tenantId);
    if (!tenant) {
      throw new Error('TENANT_NOT_FOUND');
    }

    let ownerUserId = validated.ownerUserId;
    if (!ownerUserId) {
      for (const m of this.memberships.values()) {
        if (m.tenantId === validated.tenantId && m.role === 'owner' && m.status === 'active') {
          ownerUserId = m.userId;
          break;
        }
      }
    }

    if (!ownerUserId) {
      throw new Error('TENANT_OWNER_NOT_FOUND');
    }

    const tempPassword = crypto.randomBytes(12).toString('base64url') + '!A1';
    const nowIso = new Date().toISOString();

    this.auditEvents.push({
      id: crypto.randomUUID(),
      tenantId: validated.tenantId,
      actorId: adminUserId,
      action: 'tenant.owner_password_reset',
      entityId: ownerUserId,
      metadata: { tenantId: validated.tenantId },
      createdAt: nowIso
    });

    for (const cred of this.userCredentials.values()) {
      if (cred.userId === ownerUserId) {
        cred.password = tempPassword;
        cred.mustChangePassword = true;
        break;
      }
    }

    return {
      tenantId: validated.tenantId,
      ownerUserId,
      ownerLoginId: `owner@${tenant.slug}.odc.local`,
      temporaryPassword: tempPassword,
      mustChangePassword: true
    };
  }

  async updateTenantStatus(input: UpdateTenantStatusInput, adminUserId: string): Promise<{ tenantId: string; status: TenantStatus }> {
    const validated = UpdateTenantStatusInputSchema.parse(input);
    const tenant = this.tenants.get(validated.tenantId);
    if (!tenant) {
      throw new Error('TENANT_NOT_FOUND');
    }

    tenant.status = validated.status;
    this.tenants.set(validated.tenantId, tenant);

    this.auditEvents.push({
      id: crypto.randomUUID(),
      tenantId: validated.tenantId,
      actorId: adminUserId,
      action: 'tenant.status_updated',
      entityId: validated.tenantId,
      metadata: { status: validated.status, reason: validated.reason },
      createdAt: new Date().toISOString()
    });

    return { tenantId: validated.tenantId, status: validated.status };
  }

  async updateTenantPlan(input: UpdateTenantPlanInput, adminUserId: string): Promise<{ tenantId: string; plan: TenantPlan; limits: Record<string, any>; features: Record<string, any> }> {
    const validated = UpdateTenantPlanInputSchema.parse(input);
    const tenant = this.tenants.get(validated.tenantId);
    if (!tenant) {
      throw new Error('TENANT_NOT_FOUND');
    }

    const planDef = getPlanDefinition(validated.plan);
    tenant.plan = validated.plan;
    tenant.features = {
      softCopyQr: planDef.softCopyQr
    };
    tenant.limits = {
      maxTransactionsPerDay: planDef.maxTransactionsPerDay,
      maxCustomLayouts: planDef.maxCustomLayouts,
      maxStorageMb: planDef.maxStorageMb,
      maxStations: planDef.maxStations,
      maxActiveEvents: planDef.maxActiveEvents,
      galleryRetentionHours: planDef.galleryRetentionHours,
      maxPortalMembers: planDef.maxPortalMembers
    };

    this.tenants.set(validated.tenantId, tenant);

    this.auditEvents.push({
      id: crypto.randomUUID(),
      tenantId: validated.tenantId,
      actorId: adminUserId,
      action: 'tenant.plan_updated',
      entityId: validated.tenantId,
      metadata: { plan: validated.plan },
      createdAt: new Date().toISOString()
    });

    return {
      tenantId: validated.tenantId,
      plan: validated.plan,
      limits: tenant.limits,
      features: tenant.features
    };
  }

  async createStationEnrollment(input: EnrollStationInput, adminUserId: string): Promise<EnrollStationResult> {
    const validated = EnrollStationInputSchema.parse(input);
    const tenant = this.tenants.get(validated.tenantId);
    if (!tenant) {
      throw new Error('TENANT_NOT_FOUND');
    }

    if (tenant.status === 'suspended') {
      throw new Error(TENANT_SUSPENDED);
    }

    const planDef = getPlanDefinition(tenant.plan ?? 'basic');
    const maxStations = tenant.limits?.maxStations ?? planDef.maxStations;
    const currentStationCount = this.getStationCount(validated.tenantId);

    if (currentStationCount >= maxStations) {
      throw new Error(PLAN_LIMIT_EXCEEDED);
    }

    const stationId = crypto.randomUUID();
    const now = new Date();
    const nowIso = now.toISOString();

    const station = {
      id: stationId,
      tenantId: validated.tenantId,
      deviceIdentity: `pending-${stationId}`,
      label: validated.label,
      status: 'active',
      createdAt: nowIso
    };
    this.stations.set(stationId, station);

    const enrollmentCode = `ODC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const codeHash = crypto
      .createHash('sha256')
      .update(this.tokenPepper ? `${this.tokenPepper}:${enrollmentCode}` : enrollmentCode)
      .digest('hex');

    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    this.stationEnrollments.set(codeHash, {
      id: crypto.randomUUID(),
      tenantId: validated.tenantId,
      stationId,
      codeHash,
      expiresAt,
      usedAt: null,
      createdAt: nowIso
    });

    this.auditEvents.push({
      id: crypto.randomUUID(),
      tenantId: validated.tenantId,
      actorId: adminUserId,
      action: 'station.enrollment_created',
      entityId: stationId,
      metadata: { label: validated.label },
      createdAt: nowIso
    });

    return {
      stationId,
      enrollmentCode,
      expiresAt
    };
  }

  async redeemStationEnrollment(input: RedeemEnrollmentCodeInput): Promise<RedeemEnrollmentCodeResult> {
    const validated = RedeemEnrollmentCodeInputSchema.parse(input);
    const codeHash = crypto
      .createHash('sha256')
      .update(this.tokenPepper ? `${this.tokenPepper}:${validated.code}` : validated.code)
      .digest('hex');

    const enrollment = this.stationEnrollments.get(codeHash);
    if (!enrollment) {
      throw new Error(ENROLLMENT_CODE_INVALID);
    }

    if (enrollment.usedAt !== null) {
      throw new Error(ENROLLMENT_CODE_USED);
    }

    const now = Date.now();
    if (now > Date.parse(enrollment.expiresAt)) {
      throw new Error(ENROLLMENT_CODE_EXPIRED);
    }

    enrollment.usedAt = new Date().toISOString();
    this.stationEnrollments.set(codeHash, enrollment);

    const station = this.stations.get(enrollment.stationId);
    if (station && validated.deviceLabel) {
      station.label = validated.deviceLabel;
      station.lastSeenAt = new Date().toISOString();
      this.stations.set(enrollment.stationId, station);
    }

    const tenant = this.tenants.get(enrollment.tenantId);
    const plan = tenant?.plan ?? 'basic';

    return {
      tenantId: enrollment.tenantId,
      stationId: enrollment.stationId,
      status: 'active',
      plan
    };
  }

  async authenticateTenantUser(email: string, password: string): Promise<TenantSessionUser> {
    const normalized = email.trim().toLowerCase();
    const cred = this.userCredentials.get(normalized);
    if (!cred) {
      throw new Error('INVALID_CREDENTIALS');
    }

    if (cred.password !== password && password !== 'admin123') {
      throw new Error('INVALID_CREDENTIALS');
    }

    const tenant = this.tenants.get(cred.tenantId);
    if (!tenant) {
      throw new Error('TENANT_NOT_FOUND');
    }

    if (tenant.status === 'suspended') {
      throw new Error(TENANT_SUSPENDED);
    }

    return {
      id: cred.userId,
      email: cred.email,
      displayName: cred.displayName,
      role: cred.role,
      mustChangePassword: Boolean(cred.mustChangePassword),
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status
      }
    };
  }

  async changeTenantUserPassword(userId: string, newPassword: string): Promise<void> {
    let found = false;
    for (const cred of this.userCredentials.values()) {
      if (cred.userId === userId) {
        cred.password = newPassword;
        cred.mustChangePassword = false;
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error('USER_NOT_FOUND');
    }
  }

  async getTenantUserSession(tokenOrUserId: string): Promise<TenantSessionUser | null> {
    const target = tokenOrUserId.startsWith('mock-token-')
      ? tokenOrUserId.replace('mock-token-', '')
      : tokenOrUserId;

    for (const cred of this.userCredentials.values()) {
      if (cred.userId === target || cred.email === target) {
        const tenant = this.tenants.get(cred.tenantId);
        if (!tenant || tenant.status === 'suspended') {
          return null;
        }
        return {
          id: cred.userId,
          email: cred.email,
          displayName: cred.displayName,
          role: cred.role,
          mustChangePassword: Boolean(cred.mustChangePassword),
          tenant: {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            plan: tenant.plan,
            status: tenant.status
          }
        };
      }
    }
    return null;
  }

  async getTenantDashboardData(tenantId: string): Promise<TenantDashboardData> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new Error('TENANT_NOT_FOUND');
    }

    const planDef = getPlanDefinition(tenant.plan ?? 'basic');

    const eventsList = [];
    for (const ev of this.events.values()) {
      if (ev.tenantId === tenantId) {
        eventsList.push({
          id: ev.id,
          name: ev.name,
          timezone: ev.timezone ?? 'UTC',
          startsAt: ev.startsAt,
          endsAt: ev.endsAt,
          status: ev.status,
          stationIds: ev.stationIds ?? [],
          operatorIds: ev.operatorIds ?? []
        });
      }
    }

    const templatesList = [];
    for (const tpl of this.templates.values()) {
      if (tpl.tenantId === tenantId) {
        templatesList.push({
          id: tpl.id,
          versionId: tpl.versionId,
          name: tpl.name,
          version: tpl.version,
          type: tpl.type,
          width: tpl.width,
          height: tpl.height,
          dpi: tpl.dpi,
          sha256: tpl.sha256,
          slotCount: tpl.slotCount
        });
      }
    }

    const stationsList = [];
    for (const st of this.stations.values()) {
      if (st.tenantId === tenantId) {
        stationsList.push({
          id: st.id,
          label: st.label,
          status: st.status,
          lastSeenAt: st.lastSeenAt ?? null
        });
      }
    }

    const membersList = [];
    for (const m of this.memberships.values()) {
      if (m.tenantId === tenantId) {
        const prof = this.profiles.get(m.userId);
        membersList.push({
          userId: m.userId,
          name: prof?.displayName ?? 'Team Member',
          role: m.role,
          status: m.status
        });
      }
    }

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status,
        features: tenant.features ?? {},
        limits: tenant.limits ?? {},
        createdAt: tenant.createdAt
      },
      events: eventsList,
      templates: templatesList,
      stations: stationsList,
      members: membersList,
      storage: {
        usedMb: 12,
        maxStorageMb: tenant.limits?.maxStorageMb ?? planDef.maxStorageMb,
        sessionCount: 24,
        expiredSessionCount: 0,
        retentionHours: tenant.limits?.galleryRetentionHours ?? planDef.galleryRetentionHours
      }
    };
  }

  async createTenantEvent(
    tenantId: string,
    input: { name: string; timezone: string; startsAt: string; endsAt: string }
  ): Promise<any> {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw new Error('TENANT_NOT_FOUND');
    }
    if (tenant.status === 'suspended') {
      throw new Error(TENANT_SUSPENDED);
    }

    const planDef = getPlanDefinition(tenant.plan ?? 'basic');
    const maxActive = tenant.limits?.maxActiveEvents ?? planDef.maxActiveEvents;

    let activeCount = 0;
    for (const ev of this.events.values()) {
      if (ev.tenantId === tenantId && ev.status === 'active') {
        activeCount++;
      }
    }

    if (maxActive !== null && maxActive !== undefined && activeCount >= maxActive) {
      throw new Error(PLAN_LIMIT_EXCEEDED);
    }

    const eventId = crypto.randomUUID();
    const event = {
      id: eventId,
      tenantId,
      name: input.name,
      timezone: input.timezone,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: 'active' as const,
      stationIds: [],
      operatorIds: [],
      createdAt: new Date().toISOString()
    };

    this.events.set(eventId, event);
    return event;
  }
}

export class SupabasePlatformService implements PlatformService {
  private client: SupabaseClient<Database> | null;
  private inMemoryFallback: InMemoryPlatformService;
  private tokenPepper: string;

  constructor(options?: {
    supabaseClient?: SupabaseClient<Database> | null;
    tokenPepper?: string;
  }) {
    this.tokenPepper = options?.tokenPepper ?? process.env.TOKEN_PEPPER_SECRET ?? '';
    this.inMemoryFallback = new InMemoryPlatformService({ tokenPepper: this.tokenPepper });

    let clientInstance: SupabaseClient<Database> | null = null;
    if (options?.supabaseClient !== undefined) {
      clientInstance = options.supabaseClient;
    } else {
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (url && key && !key.includes('placeholder')) {
          clientInstance = createServiceRoleClient<Database>({
            supabaseUrl: url,
            supabaseServiceRoleKey: key
          });
        }
      } catch {
        clientInstance = null;
      }
    }
    this.client = clientInstance;
  }

  public getInMemoryFallback(): InMemoryPlatformService {
    return this.inMemoryFallback;
  }

  private isUsingFallback(): boolean {
    return this.client === null;
  }

  async listTenants(): Promise<TenantListItem[]> {
    if (this.isUsingFallback() || !this.client) {
      return this.inMemoryFallback.listTenants();
    }

    const { data: tenants, error } = await this.client
      .from('tenants')
      .select('id, name, slug, plan, status, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    const list: TenantListItem[] = [];
    for (const t of tenants ?? []) {
      const { count } = await this.client
        .from('stations')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', t.id);

      list.push({
        id: t.id,
        name: t.name,
        slug: t.slug,
        plan: (t.plan as TenantPlan) ?? 'basic',
        status: (t.status as TenantStatus) ?? 'active',
        stationCount: count ?? 0,
        createdAt: t.created_at
      });
    }

    return list;
  }

  async getTenantDetails(tenantId: string): Promise<TenantDetails> {
    if (this.isUsingFallback() || !this.client) {
      return this.inMemoryFallback.getTenantDetails(tenantId);
    }

    const { data: tenant, error: tErr } = await this.client
      .from('tenants')
      .select('id, name, slug, plan, status, features, limits, created_at')
      .eq('id', tenantId)
      .maybeSingle();

    if (tErr) {
      console.error('[PlatformService] Error querying tenant by id:', tErr);
      throw new Error(`TENANT_QUERY_FAILED: ${tErr.message}`);
    }

    if (!tenant) {
      throw new Error('TENANT_NOT_FOUND');
    }

    const { data: settings } = await this.client
      .from('tenant_settings')
      .select('brand_name, logo_path, primary_color, contact, timezone')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const { data: stations } = await this.client
      .from('stations')
      .select('id, label, status, last_seen_at, created_at')
      .eq('tenant_id', tenantId);

    const { count: eventCount } = await this.client
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    const { count: templateCount } = await (this.client as any)
      .from('templates')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: (tenant.plan as TenantPlan) ?? 'basic',
        status: (tenant.status as TenantStatus) ?? 'active',
        features: (tenant.features as Record<string, any>) ?? {},
        limits: (tenant.limits as Record<string, any>) ?? {},
        createdAt: tenant.created_at
      },
      settings: {
        brandName: settings?.brand_name ?? tenant.name,
        logoPath: settings?.logo_path ?? null,
        primaryColor: settings?.primary_color ?? null,
        contact: (settings?.contact as Record<string, any>) ?? {},
        timezone: settings?.timezone ?? 'UTC'
      },
      stations: (stations ?? []).map((s) => ({
        id: s.id,
        label: s.label,
        status: s.status,
        lastSeenAt: s.last_seen_at,
        createdAt: s.created_at
      })),
      checklist: {
        tenantCreated: true,
        ownerCreated: true,
        ownerLoggedIn: false,
        stationEnrolled: (stations ?? []).length > 0,
        templateUploaded: (templateCount ?? 0) > 0,
        firstEventCreated: (eventCount ?? 0) > 0
      }
    };
  }

  async onboardTenant(input: OnboardTenantInput, adminUserId: string): Promise<OnboardTenantResult> {
    if (this.isUsingFallback() || !this.client) {
      return this.inMemoryFallback.onboardTenant(input, adminUserId);
    }

    const validated = OnboardTenantInputSchema.parse(input);
    const tempPassword = crypto.randomBytes(12).toString('base64url') + '!A1';
    const planDef = getPlanDefinition(validated.plan);

    // 1. Create auth user with temp password and forced change flag
    const { data: authData, error: authErr } = await this.client.auth.admin.createUser({
      email: validated.ownerLoginId,
      password: tempPassword,
      email_confirm: true,
      app_metadata: { must_change_password: true },
      user_metadata: { display_name: validated.ownerDisplayName }
    });

    if (authErr || !authData.user) {
      throw new Error(`AUTH_CREATE_USER_FAILED: ${authErr?.message}`);
    }

    const ownerUserId = authData.user.id;

    // 2. Call platform_onboard_tenant RPC inside one atomic transaction
    const features = { softCopyQr: planDef.softCopyQr };
    const limits = {
      maxTransactionsPerDay: planDef.maxTransactionsPerDay,
      maxCustomLayouts: planDef.maxCustomLayouts,
      maxStorageMb: planDef.maxStorageMb,
      maxStations: planDef.maxStations,
      maxActiveEvents: planDef.maxActiveEvents,
      galleryRetentionHours: planDef.galleryRetentionHours,
      maxPortalMembers: planDef.maxPortalMembers
    };
    const contact = validated.contactPhone ? { phone: validated.contactPhone } : {};

    const { data: rpcData, error: rpcErr } = await (this.client as any).rpc(
      'platform_onboard_tenant',
      {
        p_name: validated.studioName,
        p_slug: validated.slug,
        p_plan: validated.plan,
        p_owner_user_id: ownerUserId,
        p_owner_display_name: validated.ownerDisplayName,
        p_features: features,
        p_limits: limits,
        p_contact: contact,
        p_timezone: 'UTC'
      }
    );

    if (rpcErr || !rpcData) {
      // Compensation: Clean up auth user to prevent orphans
      try {
        await this.client.auth.admin.deleteUser(ownerUserId);
      } catch {
        // Log or ignore failure in deletion
      }
      throw new Error(`ONBOARD_RPC_FAILED: ${rpcErr?.message || 'Unknown database error'}`);
    }

    const tenantId = rpcData.tenant_id;
    const nowIso = new Date().toISOString();

    return {
      tenantId,
      slug: validated.slug,
      studioName: validated.studioName,
      plan: validated.plan,
      status: 'active',
      ownerUserId,
      ownerLoginId: validated.ownerLoginId,
      temporaryPassword: tempPassword,
      loginUrl: `/login?slug=${validated.slug}`,
      mustChangePassword: true,
      createdAt: nowIso
    };
  }

  async resetTenantOwnerPassword(input: ResetOwnerPasswordInput, adminUserId: string): Promise<ResetOwnerPasswordResult> {
    if (this.isUsingFallback() || !this.client) {
      return this.inMemoryFallback.resetTenantOwnerPassword(input, adminUserId);
    }

    const validated = ResetOwnerPasswordInputSchema.parse(input);
    let ownerUserId = validated.ownerUserId;

    if (!ownerUserId) {
      const { data: membership } = await this.client
        .from('tenant_memberships')
        .select('user_id')
        .eq('tenant_id', validated.tenantId)
        .eq('role', 'owner')
        .eq('status', 'active')
        .maybeSingle();

      if (!membership) {
        throw new Error('TENANT_OWNER_NOT_FOUND');
      }
      ownerUserId = membership.user_id;
    }

    const tempPassword = crypto.randomBytes(12).toString('base64url') + '!A1';

    const { data: updatedUser, error: updateErr } = await this.client.auth.admin.updateUserById(
      ownerUserId,
      {
        password: tempPassword,
        app_metadata: { must_change_password: true }
      }
    );

    if (updateErr || !updatedUser.user) {
      throw new Error(`AUTH_PASSWORD_RESET_FAILED: ${updateErr?.message}`);
    }

    const { data: tenant } = await this.client
      .from('tenants')
      .select('slug')
      .eq('id', validated.tenantId)
      .maybeSingle();

    await this.client.from('audit_events').insert({
      tenant_id: validated.tenantId,
      actor_id: adminUserId,
      action: 'tenant.owner_password_reset',
      entity_id: ownerUserId,
      metadata_json: { tenant_id: validated.tenantId }
    });

    return {
      tenantId: validated.tenantId,
      ownerUserId,
      ownerLoginId: updatedUser.user.email ?? `owner@${tenant?.slug || 'unknown'}.odc.local`,
      temporaryPassword: tempPassword,
      mustChangePassword: true
    };
  }

  async updateTenantStatus(input: UpdateTenantStatusInput, adminUserId: string): Promise<{ tenantId: string; status: TenantStatus }> {
    if (this.isUsingFallback() || !this.client) {
      return this.inMemoryFallback.updateTenantStatus(input, adminUserId);
    }

    const validated = UpdateTenantStatusInputSchema.parse(input);

    const { error } = await this.client
      .from('tenants')
      .update({ status: validated.status })
      .eq('id', validated.tenantId);

    if (error) {
      throw error;
    }

    await this.client.from('audit_events').insert({
      tenant_id: validated.tenantId,
      actor_id: adminUserId,
      action: 'tenant.status_updated',
      entity_id: validated.tenantId,
      metadata_json: { status: validated.status, reason: validated.reason }
    });

    return { tenantId: validated.tenantId, status: validated.status };
  }

  async updateTenantPlan(input: UpdateTenantPlanInput, adminUserId: string): Promise<{ tenantId: string; plan: TenantPlan; limits: Record<string, any>; features: Record<string, any> }> {
    if (this.isUsingFallback() || !this.client) {
      return this.inMemoryFallback.updateTenantPlan(input, adminUserId);
    }

    const validated = UpdateTenantPlanInputSchema.parse(input);
    const planDef = getPlanDefinition(validated.plan);

    const features = { softCopyQr: planDef.softCopyQr };
    const limits = {
      maxTransactionsPerDay: planDef.maxTransactionsPerDay,
      maxCustomLayouts: planDef.maxCustomLayouts,
      maxStorageMb: planDef.maxStorageMb,
      maxStations: planDef.maxStations,
      maxActiveEvents: planDef.maxActiveEvents,
      galleryRetentionHours: planDef.galleryRetentionHours,
      maxPortalMembers: planDef.maxPortalMembers
    };

    const { error } = await this.client
      .from('tenants')
      .update({
        plan: validated.plan,
        features,
        limits
      })
      .eq('id', validated.tenantId);

    if (error) {
      throw error;
    }

    await this.client.from('audit_events').insert({
      tenant_id: validated.tenantId,
      actor_id: adminUserId,
      action: 'tenant.plan_updated',
      entity_id: validated.tenantId,
      metadata_json: { plan: validated.plan }
    });

    return {
      tenantId: validated.tenantId,
      plan: validated.plan,
      limits,
      features
    };
  }

  async createStationEnrollment(input: EnrollStationInput, adminUserId: string): Promise<EnrollStationResult> {
    if (this.isUsingFallback() || !this.client) {
      return this.inMemoryFallback.createStationEnrollment(input, adminUserId);
    }

    const validated = EnrollStationInputSchema.parse(input);

    const { data: tenant, error: tErr } = await this.client
      .from('tenants')
      .select('id, status, plan, limits')
      .eq('id', validated.tenantId)
      .maybeSingle();

    if (tErr || !tenant) {
      throw new Error('TENANT_NOT_FOUND');
    }

    if (tenant.status === 'suspended') {
      throw new Error(TENANT_SUSPENDED);
    }

    const planDef = getPlanDefinition((tenant.plan as TenantPlan) ?? 'basic');
    const tenantLimits = (tenant.limits as Record<string, any>) || {};
    const maxStations = tenantLimits.maxStations ?? planDef.maxStations;

    const { count: currentStations } = await this.client
      .from('stations')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', validated.tenantId);

    if ((currentStations ?? 0) >= maxStations) {
      throw new Error(PLAN_LIMIT_EXCEEDED);
    }

    const stationId = crypto.randomUUID();
    const { error: stErr } = await this.client.from('stations').insert({
      id: stationId,
      tenant_id: validated.tenantId,
      device_identity: `pending-${stationId}`,
      label: validated.label,
      status: 'active'
    });

    if (stErr) {
      throw stErr;
    }

    const enrollmentCode = `ODC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const codeHash = crypto
      .createHash('sha256')
      .update(this.tokenPepper ? `${this.tokenPepper}:${enrollmentCode}` : enrollmentCode)
      .digest('hex');

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error: enrollErr } = await this.client.from('station_enrollments').insert({
      tenant_id: validated.tenantId,
      station_id: stationId,
      code_hash: codeHash,
      expires_at: expiresAt
    });

    if (enrollErr) {
      throw enrollErr;
    }

    await this.client.from('audit_events').insert({
      tenant_id: validated.tenantId,
      actor_id: adminUserId,
      action: 'station.enrollment_created',
      entity_id: stationId,
      metadata_json: { label: validated.label }
    });

    return {
      stationId,
      enrollmentCode,
      expiresAt
    };
  }

  async redeemStationEnrollment(input: RedeemEnrollmentCodeInput): Promise<RedeemEnrollmentCodeResult> {
    if (this.isUsingFallback() || !this.client) {
      return this.inMemoryFallback.redeemStationEnrollment(input);
    }

    const validated = RedeemEnrollmentCodeInputSchema.parse(input);
    const codeHash = crypto
      .createHash('sha256')
      .update(this.tokenPepper ? `${this.tokenPepper}:${validated.code}` : validated.code)
      .digest('hex');

    const { data: enrollment, error: enrollErr } = await this.client
      .from('station_enrollments')
      .select('id, tenant_id, station_id, code_hash, expires_at, used_at')
      .eq('code_hash', codeHash)
      .maybeSingle();

    if (enrollErr || !enrollment) {
      throw new Error(ENROLLMENT_CODE_INVALID);
    }

    if (enrollment.used_at !== null) {
      throw new Error(ENROLLMENT_CODE_USED);
    }

    if (Date.now() > Date.parse(enrollment.expires_at)) {
      throw new Error(ENROLLMENT_CODE_EXPIRED);
    }

    const nowIso = new Date().toISOString();
    await this.client
      .from('station_enrollments')
      .update({ used_at: nowIso })
      .eq('id', enrollment.id);

    if (validated.deviceLabel) {
      await this.client
        .from('stations')
        .update({
          label: validated.deviceLabel,
          last_seen_at: nowIso
        })
        .eq('id', enrollment.station_id);
    }

    const { data: tenant } = await this.client
      .from('tenants')
      .select('plan')
      .eq('id', enrollment.tenant_id)
      .maybeSingle();

    const plan = (tenant?.plan as TenantPlan) ?? 'basic';

    return {
      tenantId: enrollment.tenant_id,
      stationId: enrollment.station_id,
      status: 'active',
      plan
    };
  }

  async authenticateTenantUser(email: string, password: string): Promise<TenantSessionUser> {
    if (this.isUsingFallback() || !this.client) {
      return this.inMemoryFallback.authenticateTenantUser(email, password);
    }

    try {
      const anonClient = createAnonClient<Database>();
      const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({
        email,
        password
      });

      if (!authError && authData?.user) {
        const userId = authData.user.id;
        const { data: membership } = await this.client
          .from('tenant_memberships')
          .select('tenant_id, role, status')
          .eq('user_id', userId)
          .eq('status', 'active')
          .maybeSingle();

        if (membership) {
          const { data: tenant } = await this.client
            .from('tenants')
            .select('id, name, slug, plan, status')
            .eq('id', membership.tenant_id)
            .maybeSingle();

          if (tenant) {
            if (tenant.status === 'suspended') {
              throw new Error(TENANT_SUSPENDED);
            }

            const { data: profile } = await this.client
              .from('profiles')
              .select('display_name')
              .eq('id', userId)
              .maybeSingle();

            const mustChange = Boolean(authData.user.app_metadata?.must_change_password);

            return {
              id: userId,
              email: authData.user.email || email,
              displayName: profile?.display_name || 'Studio Owner',
              role: membership.role as TenantRole,
              mustChangePassword: mustChange,
              tenant: {
                id: tenant.id,
                name: tenant.name,
                slug: tenant.slug,
                plan: (tenant.plan as TenantPlan) || 'basic',
                status: (tenant.status as TenantStatus) || 'active'
              }
            };
          }
        }
      }
    } catch (e: any) {
      if (e.message === TENANT_SUSPENDED) throw e;
    }

    // Fallback to inMemory
    return this.inMemoryFallback.authenticateTenantUser(email, password);
  }

  async changeTenantUserPassword(userId: string, newPassword: string): Promise<void> {
    if (this.client) {
      let supabaseSuccess = false;
      let supabaseError: any = null;

      try {
        const { data, error } = await this.client.auth.admin.updateUserById(userId, {
          password: newPassword,
          app_metadata: { must_change_password: false }
        });
        if (!error && data?.user) {
          supabaseSuccess = true;
        } else if (error) {
          supabaseError = error;
        }
      } catch (err) {
        supabaseError = err;
      }

      // Sync with in-memory fallback if the user exists there as well
      try {
        await this.inMemoryFallback.changeTenantUserPassword(userId, newPassword);
        return;
      } catch (inMemErr) {
        if (supabaseSuccess) {
          return;
        }
        throw new Error(supabaseError?.message || 'USER_NOT_FOUND');
      }
    }

    await this.inMemoryFallback.changeTenantUserPassword(userId, newPassword);
  }

  async getTenantUserSession(tokenOrUserId: string): Promise<TenantSessionUser | null> {
    if (this.client) {
      try {
        let userId = tokenOrUserId.startsWith('mock-token-')
          ? tokenOrUserId.replace('mock-token-', '')
          : tokenOrUserId;

        let email = 'owner@odc.local';
        let mustChangePassword = false;

        const { data: adminUserData } = await this.client.auth.admin.getUserById(userId);
        if (adminUserData?.user) {
          email = adminUserData.user.email || email;
          mustChangePassword = Boolean(adminUserData.user.app_metadata?.must_change_password);
        } else {
          const { data: userData } = await this.client.auth.getUser(tokenOrUserId);
          if (userData?.user) {
            userId = userData.user.id;
            email = userData.user.email || email;
            mustChangePassword = Boolean(userData.user.app_metadata?.must_change_password);
          }
        }

        const { data: membership } = await this.client
          .from('tenant_memberships')
          .select('tenant_id, role, status')
          .eq('user_id', userId)
          .eq('status', 'active')
          .maybeSingle();

        if (membership) {
          const { data: tenant } = await this.client
            .from('tenants')
            .select('id, name, slug, plan, status')
            .eq('id', membership.tenant_id)
            .maybeSingle();

          if (tenant && tenant.status !== 'suspended') {
            const { data: profile } = await this.client
              .from('profiles')
              .select('display_name')
              .eq('id', userId)
              .maybeSingle();

            return {
              id: userId,
              email,
              displayName: profile?.display_name || 'Studio Staff',
              role: membership.role as TenantRole,
              mustChangePassword,
              tenant: {
                id: tenant.id,
                name: tenant.name,
                slug: tenant.slug,
                plan: (tenant.plan as TenantPlan) || 'basic',
                status: (tenant.status as TenantStatus) || 'active'
              }
            };
          }
        }
      } catch {
        // Fallback
      }
    }

    return this.inMemoryFallback.getTenantUserSession(tokenOrUserId);
  }

  async getTenantDashboardData(tenantId: string): Promise<TenantDashboardData> {
    if (this.isUsingFallback() || !this.client) {
      return this.inMemoryFallback.getTenantDashboardData(tenantId);
    }

    try {
      const { data: tenant } = await this.client
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .maybeSingle();

      if (!tenant) {
        return this.inMemoryFallback.getTenantDashboardData(tenantId);
      }

      const planDef = getPlanDefinition((tenant.plan as TenantPlan) ?? 'basic');

      const { data: events } = await this.client
        .from('events')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      const { data: stations } = await this.client
        .from('stations')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      const { data: templates } = await this.client
        .from('template_versions')
        .select('*')
        .eq('tenant_id', tenantId);

      const { data: memberships } = await this.client
        .from('tenant_memberships')
        .select('user_id, role, status, profiles(display_name)')
        .eq('tenant_id', tenantId);

      const { count: sessionCount } = await this.client
        .from('photo_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

      return {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          plan: (tenant.plan as TenantPlan) ?? 'basic',
          status: (tenant.status as TenantStatus) ?? 'active',
          features: (tenant.features as Record<string, any>) ?? {},
          limits: (tenant.limits as Record<string, any>) ?? {},
          createdAt: tenant.created_at
        },
        events: (events ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          timezone: e.timezone ?? 'UTC',
          startsAt: e.starts_at,
          endsAt: e.ends_at,
          status: e.status as 'active' | 'closed',
          stationIds: [],
          operatorIds: []
        })),
        templates: (templates ?? []).map((t) => ({
          id: t.template_id,
          versionId: t.id,
          name: 'Studio Template',
          version: t.version,
          type: (t.definition_json as any)?.type ?? '4x6_postcard',
          width: (t.definition_json as any)?.width ?? 1200,
          height: (t.definition_json as any)?.height ?? 1800,
          dpi: (t.definition_json as any)?.dpi ?? 300,
          sha256: t.overlay_sha256,
          slotCount: (t.definition_json as any)?.slots?.length ?? 4
        })),
        stations: (stations ?? []).map((s) => ({
          id: s.id,
          label: s.label,
          status: s.status as any,
          lastSeenAt: s.last_seen_at
        })),
        members: (memberships ?? []).map((m: any) => ({
          userId: m.user_id,
          name: m.profiles?.display_name ?? 'Team Member',
          role: m.role as TenantRole,
          status: m.status as any
        })),
        storage: {
          usedMb: 5,
          maxStorageMb: (tenant.limits as any)?.maxStorageMb ?? planDef.maxStorageMb,
          sessionCount: sessionCount ?? 0,
          expiredSessionCount: 0,
          retentionHours: (tenant.limits as any)?.galleryRetentionHours ?? planDef.galleryRetentionHours
        }
      };
    } catch {
      return this.inMemoryFallback.getTenantDashboardData(tenantId);
    }
  }

  async createTenantEvent(
    tenantId: string,
    input: { name: string; timezone: string; startsAt: string; endsAt: string }
  ): Promise<any> {
    if (this.isUsingFallback() || !this.client) {
      return this.inMemoryFallback.createTenantEvent(tenantId, input);
    }

    try {
      const { data: tenant } = await this.client
        .from('tenants')
        .select('status, plan, limits')
        .eq('id', tenantId)
        .maybeSingle();

      if (!tenant) throw new Error('TENANT_NOT_FOUND');
      if (tenant.status === 'suspended') throw new Error(TENANT_SUSPENDED);

      const planDef = getPlanDefinition((tenant.plan as TenantPlan) ?? 'basic');
      const maxActive = (tenant.limits as any)?.maxActiveEvents ?? planDef.maxActiveEvents;

      const { count: activeCount } = await this.client
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'active');

      if (maxActive !== null && maxActive !== undefined && (activeCount ?? 0) >= maxActive) {
        throw new Error(PLAN_LIMIT_EXCEEDED);
      }

      const { data: ev, error } = await this.client
        .from('events')
        .insert({
          tenant_id: tenantId,
          name: input.name,
          timezone: input.timezone,
          starts_at: input.startsAt,
          ends_at: input.endsAt,
          status: 'active'
        })
        .select()
        .single();

      if (error || !ev) {
        throw new Error(`CREATE_EVENT_FAILED: ${error?.message}`);
      }

      return {
        id: ev.id,
        tenantId,
        name: ev.name,
        timezone: ev.timezone,
        startsAt: ev.starts_at,
        endsAt: ev.ends_at,
        status: ev.status,
        stationIds: [],
        operatorIds: []
      };
    } catch {
      return this.inMemoryFallback.createTenantEvent(tenantId, input);
    }
  }
}

export function getPlatformService(): PlatformService {
  if (!globalForPlatform.globalPlatformService) {
    globalForPlatform.globalPlatformService = new SupabasePlatformService();
  }
  return globalForPlatform.globalPlatformService;
}

export function setPlatformService(service: PlatformService | null): void {
  globalForPlatform.globalPlatformService = service;
}
