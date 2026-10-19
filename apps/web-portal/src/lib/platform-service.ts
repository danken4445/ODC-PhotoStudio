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
  type TenantStatus
} from '@odc-photostudio/contracts';
import { createServiceRoleClient, type Database } from './supabase-client';
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

export interface PlatformService {
  listTenants(): Promise<TenantListItem[]>;
  getTenantDetails(tenantId: string): Promise<TenantDetails>;
  onboardTenant(input: OnboardTenantInput, adminUserId: string): Promise<OnboardTenantResult>;
  resetTenantOwnerPassword(input: ResetOwnerPasswordInput, adminUserId: string): Promise<ResetOwnerPasswordResult>;
  updateTenantStatus(input: UpdateTenantStatusInput, adminUserId: string): Promise<{ tenantId: string; status: TenantStatus }>;
  updateTenantPlan(input: UpdateTenantPlanInput, adminUserId: string): Promise<{ tenantId: string; plan: TenantPlan; limits: Record<string, any>; features: Record<string, any> }>;
  createStationEnrollment(input: EnrollStationInput, adminUserId: string): Promise<EnrollStationResult>;
  redeemStationEnrollment(input: RedeemEnrollmentCodeInput): Promise<RedeemEnrollmentCodeResult>;
}

export class InMemoryPlatformService implements PlatformService {
  private tenants = new Map<string, any>();
  private tenantSettings = new Map<string, any>();
  private profiles = new Map<string, any>();
  private memberships = new Map<string, any>();
  private stations = new Map<string, any>();
  private stationEnrollments = new Map<string, any>();
  private auditEvents: any[] = [];
  private tokenPepper: string;
  private simulateDbErrorOnOnboard = false;

  constructor(options?: { tokenPepper?: string }) {
    this.tokenPepper = options?.tokenPepper ?? process.env.TOKEN_PEPPER_SECRET ?? '';
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

    if (tErr || !tenant) {
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
}

let globalPlatformService: PlatformService | null = null;

export function getPlatformService(): PlatformService {
  if (!globalPlatformService) {
    globalPlatformService = new SupabasePlatformService();
  }
  return globalPlatformService;
}

export function setPlatformService(service: PlatformService | null): void {
  globalPlatformService = service;
}
