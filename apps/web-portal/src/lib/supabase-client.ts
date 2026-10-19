import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type TenantRole = 'owner' | 'admin' | 'operator';
export type MembershipStatus = 'active' | 'revoked' | 'invited';
export type StationStatus = 'active' | 'revoked' | 'maintenance';
export type EventStatus = 'active' | 'closed';
export type UploadState =
  | 'registering'
  | 'uploading'
  | 'verifying'
  | 'published'
  | 'failed'
  | 'expired';
export type DeletionState =
  | 'not_due'
  | 'due'
  | 'deleting'
  | 'retry_scheduled'
  | 'deleted';
export type AssetKind = 'shot' | 'composite';
export type AssetUploadState = 'pending' | 'verified' | 'deleted';
export type AssetDeletionState = 'not_due' | 'deleting' | 'deleted' | 'failed';
export type DeletionJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'retry_scheduled';

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          plan: 'basic' | 'plus' | 'business';
          status: 'active' | 'suspended' | 'closed';
          features: Json;
          limits: Json;
          onboarded_by: string | null;
          created_via: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          plan?: 'basic' | 'plus' | 'business';
          status?: 'active' | 'suspended' | 'closed';
          features?: Json;
          limits?: Json;
          onboarded_by?: string | null;
          created_via?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          plan?: 'basic' | 'plus' | 'business';
          status?: 'active' | 'suspended' | 'closed';
          features?: Json;
          limits?: Json;
          onboarded_by?: string | null;
          created_via?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      platform_admins: {
        Row: {
          user_id: string;
          role: 'superadmin' | 'support';
          created_at: string;
        };
        Insert: {
          user_id: string;
          role?: 'superadmin' | 'support';
          created_at?: string;
        };
        Update: {
          user_id?: string;
          role?: 'superadmin' | 'support';
          created_at?: string;
        };
        Relationships: [];
      };
      tenant_settings: {
        Row: {
          tenant_id: string;
          brand_name: string | null;
          logo_path: string | null;
          primary_color: string | null;
          contact: Json;
          timezone: string;
        };
        Insert: {
          tenant_id: string;
          brand_name?: string | null;
          logo_path?: string | null;
          primary_color?: string | null;
          contact?: Json;
          timezone?: string;
        };
        Update: {
          tenant_id?: string;
          brand_name?: string | null;
          logo_path?: string | null;
          primary_color?: string | null;
          contact?: Json;
          timezone?: string;
        };
        Relationships: [];
      };
      station_enrollments: {
        Row: {
          id: string;
          tenant_id: string;
          station_id: string;
          code_hash: string;
          expires_at: string;
          used_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          station_id: string;
          code_hash: string;
          expires_at: string;
          used_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          station_id?: string;
          code_hash?: string;
          expires_at?: string;
          used_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          display_name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tenant_memberships: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          role: TenantRole;
          status: MembershipStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          role: TenantRole;
          status?: MembershipStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          role?: TenantRole;
          status?: MembershipStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_memberships_tenant_id_fkey';
            columns: ['tenant_id'];
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tenant_memberships_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      stations: {
        Row: {
          id: string;
          tenant_id: string;
          device_identity: string;
          label: string;
          status: StationStatus;
          last_seen_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          device_identity: string;
          label: string;
          status?: StationStatus;
          last_seen_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          device_identity?: string;
          label?: string;
          status?: StationStatus;
          last_seen_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'stations_tenant_id_fkey';
            columns: ['tenant_id'];
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          }
        ];
      };
      events: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          timezone: string;
          starts_at: string;
          ends_at: string;
          status: EventStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          timezone?: string;
          starts_at: string;
          ends_at: string;
          status?: EventStatus;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          timezone?: string;
          starts_at?: string;
          ends_at?: string;
          status?: EventStatus;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'events_tenant_id_fkey';
            columns: ['tenant_id'];
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          }
        ];
      };
      event_assignments: {
        Row: {
          id: string;
          tenant_id: string;
          event_id: string;
          user_id: string | null;
          station_id: string | null;
          permitted_scope: string;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          event_id: string;
          user_id?: string | null;
          station_id?: string | null;
          permitted_scope?: string;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          event_id?: string;
          user_id?: string | null;
          station_id?: string | null;
          permitted_scope?: string;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'event_assignments_tenant_id_fkey';
            columns: ['tenant_id'];
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'event_assignments_user_id_fkey';
            columns: ['user_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      layout_templates: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          archived: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          archived?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          archived?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'layout_templates_tenant_id_fkey';
            columns: ['tenant_id'];
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          }
        ];
      };
      template_versions: {
        Row: {
          id: string;
          tenant_id: string;
          template_id: string;
          version: number;
          definition_json: Json;
          overlay_storage_path: string;
          overlay_sha256: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          template_id: string;
          version: number;
          definition_json: Json;
          overlay_storage_path: string;
          overlay_sha256: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          template_id?: string;
          version?: number;
          definition_json?: Json;
          overlay_storage_path?: string;
          overlay_sha256?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'template_versions_tenant_id_fkey';
            columns: ['tenant_id'];
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          }
        ];
      };
      event_templates: {
        Row: {
          tenant_id: string;
          event_id: string;
          template_version_id: string;
          created_at: string;
        };
        Insert: {
          tenant_id: string;
          event_id: string;
          template_version_id: string;
          created_at?: string;
        };
        Update: {
          tenant_id?: string;
          event_id?: string;
          template_version_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'event_templates_tenant_id_fkey';
            columns: ['tenant_id'];
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          }
        ];
      };
      photo_sessions: {
        Row: {
          id: string;
          tenant_id: string;
          event_id: string;
          station_id: string;
          operator_id: string;
          template_version_id: string;
          token_hash: string;
          captured_at: string;
          expires_at: string;
          published_at: string | null;
          upload_state: UploadState;
          deletion_state: DeletionState;
          idempotency_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          tenant_id: string;
          event_id: string;
          station_id: string;
          operator_id: string;
          template_version_id: string;
          token_hash: string;
          captured_at: string;
          expires_at: string;
          published_at?: string | null;
          upload_state?: UploadState;
          deletion_state?: DeletionState;
          idempotency_key: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          event_id?: string;
          station_id?: string;
          operator_id?: string;
          template_version_id?: string;
          token_hash?: string;
          captured_at?: string;
          expires_at?: string;
          published_at?: string | null;
          upload_state?: UploadState;
          deletion_state?: DeletionState;
          idempotency_key?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'photo_sessions_tenant_id_fkey';
            columns: ['tenant_id'];
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'photo_sessions_operator_id_fkey';
            columns: ['operator_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      session_assets: {
        Row: {
          id: string;
          tenant_id: string;
          session_id: string;
          kind: AssetKind;
          shot_index: number | null;
          storage_path: string;
          width: number;
          height: number;
          byte_size: number;
          sha256: string;
          upload_state: AssetUploadState;
          deletion_state: AssetDeletionState;
          created_at: string;
        };
        Insert: {
          id: string;
          tenant_id: string;
          session_id: string;
          kind: AssetKind;
          shot_index?: number | null;
          storage_path: string;
          width: number;
          height: number;
          byte_size: number;
          sha256: string;
          upload_state?: AssetUploadState;
          deletion_state?: AssetDeletionState;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          session_id?: string;
          kind?: AssetKind;
          shot_index?: number | null;
          storage_path?: string;
          width?: number;
          height?: number;
          byte_size?: number;
          sha256?: string;
          upload_state?: AssetUploadState;
          deletion_state?: AssetDeletionState;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'session_assets_session_id_fkey';
            columns: ['tenant_id', 'session_id'];
            referencedRelation: 'photo_sessions';
            referencedColumns: ['tenant_id', 'id'];
          }
        ];
      };
      deletion_jobs: {
        Row: {
          id: string;
          tenant_id: string;
          session_id: string;
          deadline: string;
          attempts: number;
          next_attempt_at: string;
          status: DeletionJobStatus;
          error_code: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          session_id: string;
          deadline: string;
          attempts?: number;
          next_attempt_at?: string;
          status?: DeletionJobStatus;
          error_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          session_id?: string;
          deadline?: string;
          attempts?: number;
          next_attempt_at?: string;
          status?: DeletionJobStatus;
          error_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'deletion_jobs_session_id_fkey';
            columns: ['tenant_id', 'session_id'];
            referencedRelation: 'photo_sessions';
            referencedColumns: ['tenant_id', 'id'];
          }
        ];
      };
      audit_events: {
        Row: {
          id: string;
          tenant_id: string;
          actor_id: string | null;
          action: string;
          entity_id: string;
          metadata_json: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          actor_id?: string | null;
          action: string;
          entity_id: string;
          metadata_json?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          actor_id?: string | null;
          action?: string;
          entity_id?: string;
          metadata_json?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_events_tenant_id_fkey';
            columns: ['tenant_id'];
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_events_actor_id_fkey';
            columns: ['actor_id'];
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      token_tombstones: {
        Row: {
          token_hash: string;
          expires_at: string;
          retain_until: string;
          created_at: string;
        };
        Insert: {
          token_hash: string;
          expires_at: string;
          retain_until: string;
          created_at?: string;
        };
        Update: {
          token_hash?: string;
          expires_at?: string;
          retain_until?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

/**
 * Service-role client for background jobs, webhook processing, and administrative operations.
 * Bypasses RLS policies; NEVER expose this key or client to browser runtimes.
 */
export function createServiceRoleClient<Schema = Database>(options?: {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
}): SupabaseClient<Schema> {
  const url = options?.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    options?.supabaseServiceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL environment variable is required to create Supabase service-role client.'
    );
  }
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY environment variable is required to create Supabase service-role client.'
    );
  }

  return createClient<Schema>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

/**
 * Anonymous public client using anon publishable key.
 * Subject to RLS policies (e.g. no direct session browsing).
 */
export function createAnonClient<Schema = Database>(options?: {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}): SupabaseClient<Schema> {
  const url = options?.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = options?.supabaseAnonKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL environment variable is required to create Supabase anon client.'
    );
  }
  if (!key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable is required to create Supabase anon client.'
    );
  }

  return createClient<Schema>(url, key, {
    auth: {
      persistSession: typeof window !== 'undefined',
      autoRefreshToken: typeof window !== 'undefined',
      detectSessionInUrl: typeof window !== 'undefined'
    }
  });
}

/**
 * Authenticated server-side client scoped to an active user session/token.
 * Enforces per-user RLS policies on behalf of an authenticated operator, admin, or owner.
 */
export function createAuthenticatedServerClient<Schema = Database>(
  accessToken: string,
  options?: {
    supabaseUrl?: string;
    supabaseAnonKey?: string;
  }
): SupabaseClient<Schema> {
  if (!accessToken || typeof accessToken !== 'string') {
    throw new Error('A valid accessToken is required for createAuthenticatedServerClient.');
  }

  const url = options?.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = options?.supabaseAnonKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL environment variable is required to create Supabase client.'
    );
  }
  if (!key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable is required to create Supabase client.'
    );
  }

  return createClient<Schema>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });
}
