-- ODC-PhotoStudio — Platform Superadmin, Tenant Onboarding, Tenant Settings, and Station Enrollments
-- Follows odc-superadmin-onboarding-plan.md (§3 & §4)

-- 1. Dedicated platform admins table
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'superadmin' check (role in ('superadmin', 'support')),
  created_at timestamptz not null default now()
);

-- Internal helper function to check platform admin status
create or replace function app_internal.is_platform_admin() returns boolean
  language sql stable security definer set search_path = public, pg_temp as
  $$ select exists (select 1 from public.platform_admins where user_id = auth.uid()) $$;

revoke all on function app_internal.is_platform_admin() from public;
grant execute on function app_internal.is_platform_admin() to authenticated, service_role;

-- 2. Alter public.tenants table to include plan, status, features, limits, onboarded_by, created_via
alter table public.tenants
  add column if not exists plan text not null default 'basic' check (plan in ('basic', 'plus', 'business')),
  add column if not exists status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  add column if not exists features jsonb not null default '{}'::jsonb,
  add column if not exists limits jsonb not null default '{}'::jsonb,
  add column if not exists onboarded_by uuid references auth.users(id),
  add column if not exists created_via text not null default 'odc';

-- 3. Tenant Settings (Branding and timezone settings)
create table if not exists public.tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  brand_name text,
  logo_path text,
  primary_color text,
  contact jsonb not null default '{}'::jsonb,
  timezone text not null default 'UTC'
);

-- 4. Station Enrollments (Short-lived one-time code for station activation)
create table if not exists public.station_enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  station_id uuid not null,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, station_id) references public.stations(tenant_id, id) on delete cascade
);

create index if not exists idx_station_enrollments_lookup on public.station_enrollments(code_hash, expires_at);

-- 5. Row Level Security on New Tables

alter table public.platform_admins enable row level security;
alter table public.tenant_settings enable row level security;
alter table public.station_enrollments enable row level security;

-- platform_admins: service role full access; no direct client access
create policy platform_admins_service_role on public.platform_admins
  for all to service_role
  using (true)
  with check (true);

-- tenant_settings:
-- SELECT for active tenant members
create policy tenant_settings_select_members on public.tenant_settings
  for select to authenticated
  using (
    app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin', 'operator'])
    or app_internal.is_platform_admin()
  );

-- INSERT/UPDATE/DELETE for owner or admin
create policy tenant_settings_modify_owner_admin on public.tenant_settings
  for all to authenticated
  using (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']))
  with check (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

create policy tenant_settings_service_role on public.tenant_settings
  for all to service_role
  using (true)
  with check (true);

-- station_enrollments: managed via service role and platform admin / tenant owner
create policy station_enrollments_service_role on public.station_enrollments
  for all to service_role
  using (true)
  with check (true);

-- Read-only policy for platform admins on tenants
create policy tenants_select_platform_admin on public.tenants
  for select to authenticated
  using (app_internal.is_platform_admin());

-- 6. Atomic Stored Procedure: platform_onboard_tenant
-- Inserts tenant, tenant_settings, owner profile, owner membership, and initial audit event in a single transaction.
create or replace function public.platform_onboard_tenant(
  p_name text,
  p_slug text,
  p_plan text,
  p_owner_user_id uuid,
  p_owner_display_name text,
  p_features jsonb default '{}'::jsonb,
  p_limits jsonb default '{}'::jsonb,
  p_contact jsonb default '{}'::jsonb,
  p_timezone text default 'UTC'
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_is_admin boolean;
  v_tenant_id uuid;
begin
  -- 1. Security Check: must be platform admin or service role
  v_caller_is_admin := app_internal.is_platform_admin();
  if not v_caller_is_admin and current_user not in ('postgres', 'service_role') then
    raise exception 'UNAUTHORIZED_NOT_PLATFORM_ADMIN' using errcode = '42501';
  end if;

  -- 2. Validate plan parameter
  if p_plan not in ('basic', 'plus', 'business') then
    raise exception 'INVALID_PLAN_TIER: %', p_plan;
  end if;

  -- 3. Insert tenant row
  insert into public.tenants (
    name,
    slug,
    plan,
    status,
    features,
    limits,
    onboarded_by,
    created_via
  ) values (
    p_name,
    p_slug,
    p_plan,
    'active',
    p_features,
    p_limits,
    auth.uid(),
    'odc'
  ) returning id into v_tenant_id;

  -- 4. Insert default tenant_settings
  insert into public.tenant_settings (
    tenant_id,
    brand_name,
    contact,
    timezone
  ) values (
    v_tenant_id,
    p_name,
    p_contact,
    coalesce(p_timezone, 'UTC')
  );

  -- 5. Upsert profile for owner
  insert into public.profiles (
    id,
    display_name
  ) values (
    p_owner_user_id,
    p_owner_display_name
  ) on conflict (id) do update set
    display_name = excluded.display_name,
    updated_at = now();

  -- 6. Insert tenant_membership with owner role
  insert into public.tenant_memberships (
    tenant_id,
    user_id,
    role,
    status
  ) values (
    v_tenant_id,
    p_owner_user_id,
    'owner',
    'active'
  );

  -- 7. Audit log event
  insert into public.audit_events (
    tenant_id,
    actor_id,
    action,
    entity_id,
    metadata_json
  ) values (
    v_tenant_id,
    p_owner_user_id,
    'tenant.onboarded',
    v_tenant_id::text,
    jsonb_build_object(
      'slug', p_slug,
      'plan', p_plan,
      'onboarded_by', auth.uid()
    )
  );

  return jsonb_build_object(
    'tenant_id', v_tenant_id,
    'slug', p_slug,
    'plan', p_plan,
    'owner_user_id', p_owner_user_id
  );
end;
$$;

revoke all on function public.platform_onboard_tenant from public;
grant execute on function public.platform_onboard_tenant to authenticated, service_role;

-- 7. Insert Superadmin User
insert into public.platform_admins (user_id, role)
values ('57ee24a7-144a-47f4-b13b-7c5756f48cbb', 'superadmin')
on conflict (user_id) do update set role = 'superadmin';
