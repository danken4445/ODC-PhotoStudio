'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  KeyRound,
  LayoutTemplate,
  LogOut,
  Plus,
  QrCode,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  HardDrive,
  Copy,
  Check,
  AlertCircle,
  Loader2
} from 'lucide-react';
import type { TenantRole, TenantPlan } from '@odc-photostudio/contracts';

interface RealEvent {
  id: string;
  name: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  status: 'active' | 'closed';
  stationIds: string[];
  operatorIds: string[];
}

interface RealTemplate {
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
}

interface RealMember {
  userId: string;
  name: string;
  role: TenantRole;
  status: 'active' | 'revoked';
}

interface RealStation {
  id: string;
  label: string;
  status: 'active' | 'revoked' | 'maintenance';
  lastSeenAt: string | null;
}

interface DashboardState {
  user: {
    id: string;
    email: string;
    displayName: string;
    role: TenantRole;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    plan: TenantPlan;
    status: string;
    features: Record<string, any>;
    limits: Record<string, any>;
    createdAt: string;
  };
  events: RealEvent[];
  templates: RealTemplate[];
  members: RealMember[];
  stations: RealStation[];
  storage: {
    usedMb: number;
    maxStorageMb: number;
    sessionCount: number;
    expiredSessionCount: number;
    retentionHours: number;
  };
}

export default function TenantStudioPortal(): React.JSX.Element {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<DashboardState | null>(null);
  const [activeTab, setActiveTab] = useState<'events' | 'templates' | 'staff' | 'storage'>('events');
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Modals & Actions
  const [isCreateEventOpen, setIsCreateEventOpen] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [newEventTimezone, setNewEventTimezone] = useState('Asia/Manila');
  const [newEventStartsAt, setNewEventStartsAt] = useState('');
  const [newEventEndsAt, setNewEventEndsAt] = useState('');
  const [isSubmittingEvent, setIsSubmittingEvent] = useState(false);

  const [isEnrollStationOpen, setIsEnrollStationOpen] = useState(false);
  const [newStationLabel, setNewStationLabel] = useState('');
  const [enrollmentResult, setEnrollmentResult] = useState<{ code: string; expiresAt: string } | null>(null);
  const [isSubmittingStation, setIsSubmittingStation] = useState(false);

  const [offlineGrantJson, setOfflineGrantJson] = useState<string | null>(null);
  const [isRequestingGrant, setIsRequestingGrant] = useState(false);
  const [isSweeping, setIsSweeping] = useState(false);
  const [copiedGrant, setCopiedGrant] = useState(false);

  const fetchDashboard = async () => {
    try {
      const sessionRes = await fetch('/api/auth/session');
      if (!sessionRes.ok) {
        router.replace('/login');
        return;
      }

      const dashRes = await fetch('/api/v1/tenant/dashboard');
      if (!dashRes.ok) {
        throw new Error('Failed to load studio dashboard data');
      }

      const dashData = await dashRes.json();
      setData(dashData);
      setIsLoading(false);
    } catch {
      router.replace('/login');
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionNotice(null);
    setActionError(null);

    if (!newEventName.trim() || !newEventStartsAt || !newEventEndsAt) {
      setActionError('Please fill in all event fields.');
      return;
    }

    setIsSubmittingEvent(true);
    try {
      const res = await fetch('/api/v1/tenant/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newEventName.trim(),
          timezone: newEventTimezone,
          startsAt: new Date(newEventStartsAt).toISOString(),
          endsAt: new Date(newEventEndsAt).toISOString()
        })
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to create event');
      }

      setActionNotice(`Event "${newEventName}" created successfully.`);
      setIsCreateEventOpen(false);
      setNewEventName('');
      setNewEventStartsAt('');
      setNewEventEndsAt('');
      fetchDashboard();
    } catch (err: any) {
      setActionError(err.message || 'Failed to create event');
    } finally {
      setIsSubmittingEvent(false);
    }
  };

  const handleEnrollStation = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionNotice(null);
    setActionError(null);

    setIsSubmittingStation(true);
    try {
      const res = await fetch('/api/v1/tenant/stations/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newStationLabel.trim() || 'Photo Booth Station'
        })
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to enroll station');
      }

      setEnrollmentResult({
        code: resData.enrollment.enrollmentCode,
        expiresAt: resData.enrollment.expiresAt
      });
      setActionNotice('One-time station enrollment code generated.');
      fetchDashboard();
    } catch (err: any) {
      setActionError(err.message || 'Failed to generate enrollment code');
    } finally {
      setIsSubmittingStation(false);
    }
  };

  const handleIssueOfflineGrant = async (eventId: string, stationId: string) => {
    if (!data) return;
    setActionNotice(null);
    setActionError(null);
    setIsRequestingGrant(true);

    try {
      const res = await fetch('/api/v1/station/prepare-grant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          apiVersion: 'v1',
          tenantId: data.tenant.id,
          eventId,
          stationId,
          deviceLabel: data.stations.find((s) => s.id === stationId)?.label || 'Studio Station'
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Offline grant preparation failed');
      }

      const grantData = await res.json();
      setOfflineGrantJson(JSON.stringify(grantData, null, 2));
      setActionNotice('Cryptographic 72-Hour Ed25519 Offline Station Grant issued successfully.');
    } catch (err: any) {
      setActionError(err.message || 'Failed to issue offline grant');
    } finally {
      setIsRequestingGrant(false);
    }
  };

  const handleTriggerDeletionSweep = async () => {
    setActionNotice(null);
    setActionError(null);
    setIsSweeping(true);

    try {
      const res = await fetch('/api/v1/internal/cron/deletion-sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const result = await res.json();
      if (res.ok) {
        setActionNotice(
          `Privacy Lifecycle Sweep executed: ${result.sweptCount || 0} expired sessions permanently cleaned.`
        );
        fetchDashboard();
      } else {
        throw new Error(result.error || 'Deletion sweep failed');
      }
    } catch (err: any) {
      setActionError(err.message || 'Deletion sweep failed');
    } finally {
      setIsSweeping(false);
    }
  };

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-400 flex flex-col items-center justify-center space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <p className="text-sm">Connecting to studio database...</p>
      </div>
    );
  }

  const usedMb = data.storage.usedMb;
  const maxStorageMb = data.storage.maxStorageMb;
  const storagePercent = Math.min(100, Math.round((usedMb / (maxStorageMb || 1024)) * 100));

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-blue-500/30 selection:text-blue-200">
      {/* Top Header */}
      <header className="border-b border-zinc-800/80 bg-zinc-900/60 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-blue-600/10 border border-blue-500/30 text-blue-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-lg font-bold text-white tracking-tight">{data.tenant.name}</h1>
                <span className="text-xs uppercase px-2 py-0.5 rounded-full font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  {data.tenant.plan}
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-mono">slug: {data.tenant.slug}</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300">
              <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-medium text-white">{data.user.displayName}</span>
              <span className="text-zinc-500">|</span>
              <span className="capitalize text-zinc-400 font-semibold">{data.user.role}</span>
            </div>

            <button
              onClick={handleSignOut}
              className="inline-flex items-center space-x-1.5 text-xs px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Notice Banners */}
        {actionNotice && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>{actionNotice}</span>
            </div>
            <button onClick={() => setActionNotice(null)} className="text-xs text-emerald-400 hover:underline">
              Dismiss
            </button>
          </div>
        )}

        {actionError && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <span>{actionError}</span>
            </div>
            <button onClick={() => setActionError(null)} className="text-xs text-red-400 hover:underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex border-b border-zinc-800 space-x-6 text-sm">
          <button
            onClick={() => setActiveTab('events')}
            className={`pb-3 font-medium flex items-center space-x-2 transition-colors border-b-2 ${
              activeTab === 'events'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Events & Station Grants</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
              {data.events.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('templates')}
            className={`pb-3 font-medium flex items-center space-x-2 transition-colors border-b-2 ${
              activeTab === 'templates'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <LayoutTemplate className="w-4 h-4" />
            <span>Template Studio</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
              {data.templates.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('staff')}
            className={`pb-3 font-medium flex items-center space-x-2 transition-colors border-b-2 ${
              activeTab === 'staff'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Staff & Stations</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
              {data.stations.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('storage')}
            className={`pb-3 font-medium flex items-center space-x-2 transition-colors border-b-2 ${
              activeTab === 'storage'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Storage & Privacy Lifecycle</span>
          </button>
        </div>

        {/* TAB 1: Events & Station Grants */}
        {activeTab === 'events' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-white">Active Studio Events</h2>
                <p className="text-xs text-zinc-400">
                  Manage live event assignments and generate offline cryptographic preparation packages for operator stations.
                </p>
              </div>

              {data.user.role !== 'operator' && (
                <button
                  onClick={() => setIsCreateEventOpen(true)}
                  className="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-md shadow-blue-600/20"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Event</span>
                </button>
              )}
            </div>

            {data.events.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-zinc-800 rounded-2xl bg-zinc-900/30">
                <Calendar className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-zinc-300">No events created yet</h3>
                <p className="text-xs text-zinc-500 mt-1">Create your first event to start issuing operator station grants.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.events.map((event) => (
                  <div
                    key={event.id}
                    className="p-5 rounded-2xl bg-zinc-900/70 border border-zinc-800 hover:border-zinc-700 transition-all space-y-4"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="text-base font-bold text-white">{event.name}</h3>
                        <div className="flex items-center space-x-2 text-xs text-zinc-400 mt-1">
                          <Clock className="w-3.5 h-3.5 text-zinc-500" />
                          <span>Timezone: {event.timezone}</span>
                        </div>
                      </div>
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase ${
                          event.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {event.status}
                      </span>
                    </div>

                    <div className="text-xs text-zinc-400 space-y-1 bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80">
                      <div>Starts: {new Date(event.startsAt).toLocaleString()}</div>
                      <div>Ends: {new Date(event.endsAt).toLocaleString()}</div>
                    </div>

                    <div className="pt-2 flex items-center justify-between">
                      <button
                        onClick={() => {
                          const station = data.stations[0];
                          if (!station) {
                            setActionError('Please enroll at least one station hardware device first.');
                            return;
                          }
                          handleIssueOfflineGrant(event.id, station.id);
                        }}
                        disabled={isRequestingGrant}
                        className="inline-flex items-center space-x-2 text-xs font-semibold px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors"
                      >
                        <KeyRound className="w-3.5 h-3.5 text-blue-400" />
                        <span>Issue 72-Hour Offline Grant</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Offline Grant Modal / Result */}
            {offlineGrantJson && (
              <div className="p-5 rounded-2xl bg-zinc-900 border border-blue-500/30 space-y-3">
                <div className="flex justify-between items-center">
                  <div className="flex items-center space-x-2">
                    <ShieldCheck className="w-5 h-5 text-blue-400" />
                    <h3 className="text-sm font-bold text-white">Signed 72-Hour Ed25519 Offline Station Grant</h3>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(offlineGrantJson);
                        setCopiedGrant(true);
                        setTimeout(() => setCopiedGrant(false), 2000);
                      }}
                      className="inline-flex items-center space-x-1 text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
                    >
                      {copiedGrant ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedGrant ? 'Copied' : 'Copy JSON'}</span>
                    </button>
                    <button
                      onClick={() => setOfflineGrantJson(null)}
                      className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1"
                    >
                      Close
                    </button>
                  </div>
                </div>
                <pre className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-300 max-h-64 overflow-y-auto">
                  {offlineGrantJson}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Template Studio */}
        {activeTab === 'templates' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-white">Print Template Engine</h2>
              <p className="text-xs text-zinc-400">
                Immutable, cryptographic template definitions verified against SHA-256 overlay hashes for offline printing.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="p-5 rounded-2xl bg-zinc-900/70 border border-zinc-800 space-y-4"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-base font-bold text-white">{tpl.name}</h3>
                      <p className="text-xs text-zinc-500 font-mono">v{tpl.version} • {tpl.type}</p>
                    </div>
                    <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30">
                      {tpl.slotCount} Photo Slots
                    </span>
                  </div>

                  <div className="text-xs text-zinc-400 space-y-1.5 bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80 font-mono">
                    <div>Dimensions: {tpl.width} x {tpl.height} px ({tpl.dpi} DPI)</div>
                    <div className="truncate">SHA-256: {tpl.sha256}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: Staff & Stations */}
        {activeTab === 'staff' && (
          <div className="space-y-8">
            {/* Stations Section */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-base font-bold text-white">Hardware Operator Stations</h3>
                  <p className="text-xs text-zinc-400">
                    Windows 11 desktop photo booths provisioned for offline event capture.
                  </p>
                </div>

                {data.user.role !== 'operator' && (
                  <button
                    onClick={() => {
                      setEnrollmentResult(null);
                      setIsEnrollStationOpen(true);
                    }}
                    className="inline-flex items-center space-x-1.5 text-xs font-semibold px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Enroll Station</span>
                  </button>
                )}
              </div>

              {data.stations.length === 0 ? (
                <div className="text-center py-8 border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30 text-xs text-zinc-500">
                  No stations enrolled. Click "Enroll Station" to generate an activation code.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {data.stations.map((st) => (
                    <div
                      key={st.id}
                      className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800 flex justify-between items-center"
                    >
                      <div>
                        <div className="text-sm font-bold text-white">{st.label}</div>
                        <div className="text-xs text-zinc-500 font-mono mt-0.5">ID: {st.id}</div>
                      </div>
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        {st.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Staff Section */}
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-bold text-white">Team Members & Access Roles</h3>
                <p className="text-xs text-zinc-400">
                  Manage studio staff memberships and role-based permissions (Owner, Admin, Operator).
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.members.map((m) => (
                  <div
                    key={m.userId}
                    className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800 flex justify-between items-center"
                  >
                    <div>
                      <div className="text-sm font-bold text-white">{m.name}</div>
                      <div className="text-xs text-zinc-500 font-mono mt-0.5">{m.userId}</div>
                    </div>
                    <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase bg-blue-500/10 text-blue-400 border border-blue-500/30">
                      {m.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: Storage & Privacy Lifecycle */}
        {activeTab === 'storage' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-white">Storage & Privacy Retention Lifecycle</h2>
              <p className="text-xs text-zinc-400">
                Enforcing strict 24-hour privacy expiration on soft-copy customer galleries and assets.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Storage Meter */}
              <div className="p-6 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/30">
                    <HardDrive className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Cloud Storage Allocation</h3>
                    <p className="text-xs text-zinc-400">Current plan: {data.tenant.plan.toUpperCase()}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-zinc-400">Used: {usedMb} MB</span>
                    <span className="text-zinc-200">Cap: {maxStorageMb} MB</span>
                  </div>
                  <div className="w-full h-2.5 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${storagePercent}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Privacy Lifecycle */}
              <div className="p-6 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">24-Hour Privacy Purge Guarantee</h3>
                    <p className="text-xs text-zinc-400">
                      Customer galleries automatically expire after {data.storage.retentionHours} hours.
                    </p>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={handleTriggerDeletionSweep}
                    disabled={isSweeping}
                    className="inline-flex items-center space-x-2 text-xs font-semibold px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors disabled:opacity-50"
                  >
                    {isSweeping ? (
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                    ) : (
                      <RefreshCw className="w-4 h-4 text-emerald-400" />
                    )}
                    <span>Trigger Privacy Sweep Now</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Create Event Modal */}
      {isCreateEventOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Create New Studio Event</h3>
            <form onSubmit={handleCreateEvent} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                  Event Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Wedding Reception"
                  value={newEventName}
                  onChange={(e) => setNewEventName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                  Timezone
                </label>
                <input
                  type="text"
                  value={newEventTimezone}
                  onChange={(e) => setNewEventTimezone(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                    Starts At
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={newEventStartsAt}
                    onChange={(e) => setNewEventStartsAt(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                    Ends At
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={newEventEndsAt}
                    onChange={(e) => setNewEventEndsAt(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsCreateEventOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEvent}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                >
                  {isSubmittingEvent ? 'Creating...' : 'Save Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Enroll Station Modal */}
      {isEnrollStationOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Enroll Operator Desktop Station</h3>
            {!enrollmentResult ? (
              <form onSubmit={handleEnrollStation} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">
                    Device Label
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. PhotoBooth Station 1 (Main Hall)"
                    value={newStationLabel}
                    onChange={(e) => setNewStationLabel(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <p className="text-xs text-zinc-400">
                  This generates a one-time 8-character activation code to pair an operator PC running the desktop app.
                </p>

                <div className="pt-2 flex justify-end space-x-2">
                  <button
                    type="button"
                    onClick={() => setIsEnrollStationOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingStation}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                  >
                    {isSubmittingStation ? 'Generating...' : 'Generate Code'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4 text-center py-2">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                <div>
                  <p className="text-xs text-zinc-400">One-Time Activation Code for Desktop App:</p>
                  <div className="mt-2 p-3 bg-zinc-950 border border-zinc-800 rounded-xl text-2xl font-mono font-extrabold text-blue-400 tracking-wider">
                    {enrollmentResult.code}
                  </div>
                </div>
                <p className="text-xs text-zinc-500">
                  Expires: {new Date(enrollmentResult.expiresAt).toLocaleString()}
                </p>
                <button
                  onClick={() => setIsEnrollStationOpen(false)}
                  className="w-full py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
