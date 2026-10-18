-- ODC-PhotoStudio — Initial Multi-Tenant Schema, Composite Foreign Keys, and RLS Policies
-- Specification Sections 8, 9, 10, 11

create extension if not exists "pgcrypto";

-- 1. Tenants (Root identity; exempt from self-referential tenant_id)
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  created_at timestamptz not null default now()
);

-- 2. Profiles (Global auth-linked user identity; no mutable tenant role here)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Tenant Memberships (Explicit active tenant role and status)
create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'operator')),
  status text not null default 'active' check (status in ('active', 'revoked', 'invited')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

-- 4. Stations (Same-tenant composite unique key for FK enforcement)
create table public.stations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  device_identity text not null,
  label text not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'maintenance')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, device_identity)
);

-- 5. Events
create table public.events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  timezone text not null default 'UTC',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (tenant_id, id)
);

-- 6. Event Assignments (Scopes operators and stations to specific events within the same tenant)
create table public.event_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid not null,
  user_id uuid references public.profiles(id) on delete cascade,
  station_id uuid,
  permitted_scope text not null default 'capture_and_print',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, event_id) references public.events(tenant_id, id) on delete cascade,
  foreign key (tenant_id, station_id) references public.stations(tenant_id, id) on delete cascade,
  check (user_id is not null or station_id is not null)
);

-- 7. Layout Templates
create table public.layout_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

-- 8. Immutable Template Versions
create table public.template_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid not null,
  version integer not null check (version > 0),
  definition_json jsonb not null,
  overlay_storage_path text not null,
  overlay_sha256 text not null check (overlay_sha256 ~ '^[a-fA-F0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, template_id) references public.layout_templates(tenant_id, id) on delete cascade,
  unique (tenant_id, id),
  unique (tenant_id, template_id, version)
);

-- 9. Event Templates (Assigns immutable template versions to events within the same tenant)
create table public.event_templates (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid not null,
  template_version_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, event_id, template_version_id),
  foreign key (tenant_id, event_id) references public.events(tenant_id, id) on delete cascade,
  foreign key (tenant_id, template_version_id) references public.template_versions(tenant_id, id) on delete restrict
);

-- 10. Photo Sessions
-- Enforces same-tenant references for event, station, and template_version.
-- Stores ONLY token_hash (never plaintext gallery token).
create table public.photo_sessions (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  event_id uuid not null,
  station_id uuid not null,
  operator_id uuid not null references public.profiles(id) on delete restrict,
  template_version_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[a-fA-F0-9]{64}$'),
  captured_at timestamptz not null,
  expires_at timestamptz not null,
  published_at timestamptz,
  upload_state text not null default 'registering' check (
    upload_state in ('registering', 'uploading', 'verifying', 'published', 'failed', 'expired')
  ),
  deletion_state text not null default 'not_due' check (
    deletion_state in ('not_due', 'due', 'deleting', 'retry_scheduled', 'deleted')
  ),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Authoritative 24-hour rule check
  check (expires_at = captured_at + interval '24 hours'),
  unique (tenant_id, id),
  foreign key (tenant_id, event_id) references public.events(tenant_id, id) on delete restrict,
  foreign key (tenant_id, station_id) references public.stations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, template_version_id) references public.template_versions(tenant_id, id) on delete restrict
);

-- 11. Session Assets (Stores private object path, never public or durable signed URLs)
create table public.session_assets (
  id uuid primary key,
  tenant_id uuid not null,
  session_id uuid not null,
  kind text not null check (kind in ('shot', 'composite')),
  shot_index integer check (shot_index is null or shot_index >= 0),
  storage_path text not null unique,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  byte_size integer not null check (byte_size > 0),
  sha256 text not null check (sha256 ~ '^[a-fA-F0-9]{64}$'),
  upload_state text not null default 'pending' check (upload_state in ('pending', 'verified', 'deleted')),
  deletion_state text not null default 'not_due' check (deletion_state in ('not_due', 'deleting', 'deleted', 'failed')),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, session_id) references public.photo_sessions(tenant_id, id) on delete cascade
);

-- 12. Deletion Jobs (Coordinates Storage API removal every 5 minutes)
create table public.deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  session_id uuid not null,
  deadline timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'retry_scheduled')),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id),
  foreign key (tenant_id, session_id) references public.photo_sessions(tenant_id, id) on delete cascade
);

-- 13. Audit Events (Retained 30 days; excludes gallery tokens and guest identity)
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_id text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Indexes (Section 11)
create index idx_memberships_user_tenant on public.tenant_memberships(user_id, tenant_id, status);
create index idx_events_tenant_status on public.events(tenant_id, status);
create index idx_sessions_tenant_event on public.photo_sessions(tenant_id, event_id, upload_state);
create index idx_sessions_expiration_sweep on public.photo_sessions(expires_at, deletion_state);
create index idx_deletion_jobs_due on public.deletion_jobs(status, next_attempt_at);
create index idx_audit_events_retention on public.audit_events(created_at);

-- Enable Row-Level Security on ALL tables (Section 10)
alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.stations enable row level security;
alter table public.events enable row level security;
alter table public.event_assignments enable row level security;
alter table public.layout_templates enable row level security;
alter table public.template_versions enable row level security;
alter table public.event_templates enable row level security;
alter table public.photo_sessions enable row level security;
alter table public.session_assets enable row level security;
alter table public.deletion_jobs enable row level security;
alter table public.audit_events enable row level security;

-- Helper functions in internal schema with fixed search_path (Section 10.2)
create schema if not exists app_internal;

create or replace function app_internal.has_active_tenant_role(
  p_tenant_id uuid,
  p_allowed_roles text[]
) returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.tenant_memberships tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role = any(p_allowed_roles)
  );
$$;

create or replace function app_internal.is_assigned_to_event(
  p_tenant_id uuid,
  p_event_id uuid
) returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.event_assignments ea
    where ea.tenant_id = p_tenant_id
      and ea.event_id = p_event_id
      and ea.user_id = auth.uid()
      and ea.active = true
  );
$$;

revoke all on schema app_internal from public;
grant usage on schema app_internal to authenticated;
grant execute on function app_internal.has_active_tenant_role(uuid, text[]) to authenticated;
grant execute on function app_internal.is_assigned_to_event(uuid, uuid) to authenticated;

-- RLS Policies: Explicit per-operation policies; NO public/anonymous SELECT on photo_sessions (A13)
create policy tenants_select_member on public.tenants
  for select to authenticated
  using (app_internal.has_active_tenant_role(id, array['owner', 'admin', 'operator']));

create policy memberships_select_self_or_admin on public.tenant_memberships
  for select to authenticated
  using (
    user_id = auth.uid()
    or app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin'])
  );

-- Only owners can manage owner roles; admins/owners manage operators; users cannot self-escalate
create policy memberships_Write_owner_admin on public.tenant_memberships
  for all to authenticated
  using (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']))
  with check (
    (role = 'owner' and app_internal.has_active_tenant_role(tenant_id, array['owner']))
    or (role in ('admin', 'operator') and app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']))
  );

create policy events_select_scoped on public.events
  for select to authenticated
  using (
    app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin'])
    or (
      app_internal.has_active_tenant_role(tenant_id, array['operator'])
      and app_internal.is_assigned_to_event(tenant_id, id)
    )
  );

create policy events_modify_owner_admin on public.events
  for all to authenticated
  using (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']))
  with check (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

-- Photo Sessions: NO anonymous policy exists. Operators only see assigned events.
create policy photo_sessions_select_scoped on public.photo_sessions
  for select to authenticated
  using (
    app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin'])
    or (
      app_internal.has_active_tenant_role(tenant_id, array['operator'])
      and app_internal.is_assigned_to_event(tenant_id, event_id)
    )
  );
