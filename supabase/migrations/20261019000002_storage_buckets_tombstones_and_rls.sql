-- ODC-PhotoStudio — Storage Buckets, Token Tombstones, and Remaining RLS Policies
-- Specification Sections 8, 9, 10, 11

-- 1. Storage Buckets Provisioning
-- Ensure private storage buckets for session media and template overlays exist.
insert into storage.buckets (id, name, public)
values
  ('session-media', 'session-media', false),
  ('template-overlays', 'template-overlays', false)
on conflict (id) do update set
  public = excluded.public;

-- 2. Token Tombstones Table
-- Stores cryptographic SHA-256 hashes of expired gallery tokens for authoritative expiration notices (Section 9.3)
create table if not exists public.token_tombstones (
  token_hash text primary key check (token_hash ~ '^[a-fA-F0-9]{64}$'),
  expires_at timestamptz not null,
  retain_until timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_token_tombstones_retain_until on public.token_tombstones(retain_until);

alter table public.token_tombstones enable row level security;

-- Token tombstones RLS: accessed by service role during lookup / retention cleanup
create policy token_tombstones_service_role on public.token_tombstones
  for all to service_role
  using (true)
  with check (true);

-- 3. Stations RLS Policies (SELECT, INSERT, UPDATE, DELETE for owners/admins)
create policy stations_select_owner_admin on public.stations
  for select to authenticated
  using (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

create policy stations_insert_owner_admin on public.stations
  for insert to authenticated
  with check (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

create policy stations_update_owner_admin on public.stations
  for update to authenticated
  using (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']))
  with check (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

create policy stations_delete_owner_admin on public.stations
  for delete to authenticated
  using (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

-- 4. Layout Templates RLS Policies (SELECT, INSERT, UPDATE, DELETE for owners/admins)
create policy layout_templates_select_owner_admin on public.layout_templates
  for select to authenticated
  using (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

create policy layout_templates_insert_owner_admin on public.layout_templates
  for insert to authenticated
  with check (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

create policy layout_templates_update_owner_admin on public.layout_templates
  for update to authenticated
  using (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']))
  with check (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

create policy layout_templates_delete_owner_admin on public.layout_templates
  for delete to authenticated
  using (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

-- 5. Template Versions RLS Policies (SELECT, INSERT for owners/admins; immutable versions)
create policy template_versions_select_owner_admin on public.template_versions
  for select to authenticated
  using (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

create policy template_versions_insert_owner_admin on public.template_versions
  for insert to authenticated
  with check (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

-- 6. Event Assignments RLS Policies (SELECT, INSERT, UPDATE, DELETE for owners/admins)
create policy event_assignments_select_owner_admin on public.event_assignments
  for select to authenticated
  using (
    app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin'])
    or (
      app_internal.has_active_tenant_role(tenant_id, array['operator'])
      and user_id = auth.uid()
    )
  );

create policy event_assignments_insert_owner_admin on public.event_assignments
  for insert to authenticated
  with check (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

create policy event_assignments_update_owner_admin on public.event_assignments
  for update to authenticated
  using (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']))
  with check (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

create policy event_assignments_delete_owner_admin on public.event_assignments
  for delete to authenticated
  using (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

-- 7. Event Templates RLS Policies (SELECT, INSERT, DELETE for owners/admins)
create policy event_templates_select_owner_admin on public.event_templates
  for select to authenticated
  using (
    app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin'])
    or (
      app_internal.has_active_tenant_role(tenant_id, array['operator'])
      and app_internal.is_assigned_to_event(tenant_id, event_id)
    )
  );

create policy event_templates_insert_owner_admin on public.event_templates
  for insert to authenticated
  with check (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

create policy event_templates_delete_owner_admin on public.event_templates
  for delete to authenticated
  using (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

-- 8. Session Assets RLS Policies (SELECT for active operators/admins assigned to event)
create policy session_assets_select_scoped on public.session_assets
  for select to authenticated
  using (
    app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin'])
    or (
      app_internal.has_active_tenant_role(tenant_id, array['operator'])
      and exists (
        select 1
        from public.photo_sessions ps
        where ps.tenant_id = session_assets.tenant_id
          and ps.id = session_assets.session_id
          and app_internal.is_assigned_to_event(ps.tenant_id, ps.event_id)
      )
    )
  );

-- 9. Deletion Jobs RLS Policies (service role / admin access)
create policy deletion_jobs_admin_all on public.deletion_jobs
  for all to authenticated
  using (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']))
  with check (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

create policy deletion_jobs_service_role on public.deletion_jobs
  for all to service_role
  using (true)
  with check (true);

-- 10. Audit Events RLS Policies (INSERT for authenticated, SELECT for owners/admins)
create policy audit_events_select_owner_admin on public.audit_events
  for select to authenticated
  using (app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin']));

create policy audit_events_insert_authenticated on public.audit_events
  for insert to authenticated
  with check (
    app_internal.has_active_tenant_role(tenant_id, array['owner', 'admin', 'operator'])
  );

create policy audit_events_service_role on public.audit_events
  for all to service_role
  using (true)
  with check (true);

-- 11. Profiles RLS Policies (Self-select and self-update)
create policy profiles_select_authenticated on public.profiles
  for select to authenticated
  using (true);

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
