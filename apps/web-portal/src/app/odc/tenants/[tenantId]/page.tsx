'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2,
  ChevronLeft,
  ShieldCheck,
  AlertTriangle,
  Monitor,
  RefreshCw,
  KeyRound,
  PauseCircle,
  PlayCircle,
  PlusCircle,
  Copy,
  Check,
  X,
  CheckCircle2,
  Circle,
  Clock,
  Sparkles,
  Layers,
  HardDrive,
  QrCode,
  Calendar,
  ExternalLink
} from 'lucide-react';
import type { TenantPlan, TenantStatus } from '@odc-photostudio/contracts';

interface TenantDetailData {
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
    enrollmentCode?: string;
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

export default function OdcTenantDetailPage({
  params
}: {
  params: Promise<{ tenantId: string }>;
}): React.JSX.Element {
  const router = useRouter();
  const { tenantId } = use(params);

  const [data, setData] = useState<TenantDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Modal States
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [selectedNewPlan, setSelectedNewPlan] = useState<TenantPlan>('basic');
  const [isUpdatingPlan, setIsUpdatingPlan] = useState(false);

  const [isSuspendModalOpen, setIsSuspendModalOpen] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(false);
  const [stationLabel, setStationLabel] = useState('');
  const [enrollmentResult, setEnrollmentResult] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [isEnrollingStation, setIsEnrollingStation] = useState(false);

  // Copy Feedback
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fetchTenant = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/odc/tenants/${tenantId}`);
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Tenant studio not found.');
        }
        throw new Error('Failed to load tenant details.');
      }
      const tenantData = (await res.json()) as TenantDetailData;
      setData(tenantData);
      setSelectedNewPlan(tenantData.tenant.plan);
    } catch (err: any) {
      setError(err.message || 'Error loading tenant details.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTenant();
  }, [tenantId]);

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Fallback
    }
  };

  // 1. Change Plan
  const handleChangePlan = async () => {
    if (!data) return;
    setIsUpdatingPlan(true);
    try {
      const res = await fetch(`/api/odc/tenants/${tenantId}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selectedNewPlan })
      });
      if (!res.ok) {
        throw new Error('Failed to update subscription plan.');
      }
      setIsPlanModalOpen(false);
      setActionNotice(`Plan successfully updated to ${selectedNewPlan.toUpperCase()}.`);
      await fetchTenant();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsUpdatingPlan(false);
    }
  };

  // 2. Suspend / Reactivate Tenant
  const handleToggleStatus = async () => {
    if (!data) return;
    const targetStatus: TenantStatus = data.tenant.status === 'active' ? 'suspended' : 'active';
    setIsUpdatingStatus(true);
    try {
      const res = await fetch(`/api/odc/tenants/${tenantId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetStatus })
      });
      if (!res.ok) {
        throw new Error(`Failed to update tenant status to ${targetStatus}.`);
      }
      setIsSuspendModalOpen(false);
      setActionNotice(
        targetStatus === 'suspended'
          ? 'Tenant has been suspended. Offline grants and login are disabled.'
          : 'Tenant has been reactivated.'
      );
      await fetchTenant();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // 3. Reset Owner Password
  const handleResetPassword = async () => {
    setIsResettingPassword(true);
    setGeneratedPassword(null);
    try {
      const res = await fetch(`/api/odc/tenants/${tenantId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!res.ok) {
        throw new Error('Failed to reset owner password.');
      }
      const resData = await res.json();
      setGeneratedPassword(resData.temporaryPassword);
      setIsPasswordModalOpen(true);
      setActionNotice('New temporary password generated for studio owner.');
      await fetchTenant();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsResettingPassword(false);
    }
  };

  // 4. Enroll Station
  const handleEnrollStation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stationLabel.trim()) return;

    setIsEnrollingStation(true);
    setEnrollmentResult(null);
    try {
      const res = await fetch(`/api/odc/tenants/${tenantId}/enroll-station`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: stationLabel.trim() })
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 403 && errJson.error === 'PLAN_LIMIT_EXCEEDED') {
          throw new Error('Plan limit reached: upgrade plan to enroll more stations.');
        }
        throw new Error(errJson.message || 'Failed to enroll station.');
      }
      const resData = await res.json();
      setEnrollmentResult({
        code: resData.enrollmentCode,
        expiresAt: resData.expiresAt
      });
      setStationLabel('');
      await fetchTenant();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsEnrollingStation(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-zinc-400 text-sm">Loading studio details...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4">
        <div className="inline-flex p-3 rounded-full bg-red-500/10 text-red-400">
          <AlertTriangle className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-white">Error Loading Tenant</h2>
        <p className="text-sm text-zinc-400">{error}</p>
        <Link
          href="/odc"
          className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 text-sm font-semibold"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back to Tenants</span>
        </Link>
      </div>
    );
  }

  if (!data) return <div />;

  const { tenant, settings, stations, checklist } = data;
  const completedChecklistCount = Object.values(checklist).filter(Boolean).length;
  const checklistPercent = Math.round((completedChecklistCount / 6) * 100);

  return (
    <div className="space-y-8 pb-12">
      {/* Breadcrumb & Navigation */}
      <div className="flex items-center space-x-2 text-xs text-zinc-500">
        <Link href="/odc" className="hover:text-zinc-300 transition-colors flex items-center space-x-1">
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>Tenants</span>
        </Link>
        <span>/</span>
        <span className="text-zinc-300 font-mono">{tenant.slug}</span>
      </div>

      {/* Action Notification Banner */}
      {actionNotice && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>{actionNotice}</span>
          </div>
          <button
            onClick={() => setActionNotice(null)}
            className="text-amber-400 hover:text-amber-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header with Badges & Quick Action Controls */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-xl flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center space-x-3 flex-wrap gap-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {tenant.name}
            </h1>

            {/* Plan Badge */}
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
                tenant.plan === 'business'
                  ? 'bg-purple-500/10 text-purple-400 border border-purple-500/30'
                  : tenant.plan === 'plus'
                  ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                  : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
              }`}
            >
              {tenant.plan} Plan
            </span>

            {/* Status Badge */}
            <span
              className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                tenant.status === 'active'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  tenant.status === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
              <span className="capitalize">{tenant.status}</span>
            </span>
          </div>

          <p className="text-xs sm:text-sm text-zinc-400 font-mono">
            ID: {tenant.id} · Slug: <strong className="text-zinc-200">{tenant.slug}</strong>
          </p>
        </div>

        {/* Quick Actions Toolbar */}
        <div className="flex items-center flex-wrap gap-2.5">
          {/* Change Plan Button */}
          <button
            onClick={() => {
              setSelectedNewPlan(tenant.plan);
              setIsPlanModalOpen(true);
            }}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-semibold text-zinc-200 transition-colors shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Change Plan</span>
          </button>

          {/* Reset Password Button */}
          <button
            onClick={handleResetPassword}
            disabled={isResettingPassword}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-semibold text-zinc-200 transition-colors shadow-sm disabled:opacity-50"
          >
            <KeyRound className="w-3.5 h-3.5 text-blue-400" />
            <span>{isResettingPassword ? 'Generating...' : 'Reset Owner Password'}</span>
          </button>

          {/* Suspend / Reactivate Button */}
          <button
            onClick={() => setIsSuspendModalOpen(true)}
            className={`inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-lg border text-xs font-semibold transition-colors shadow-sm ${
              tenant.status === 'active'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
            }`}
          >
            {tenant.status === 'active' ? (
              <>
                <PauseCircle className="w-3.5 h-3.5" />
                <span>Suspend Tenant</span>
              </>
            ) : (
              <>
                <PlayCircle className="w-3.5 h-3.5" />
                <span>Reactivate Tenant</span>
              </>
            )}
          </button>

          {/* Enroll Station Button */}
          <button
            onClick={() => {
              setEnrollmentResult(null);
              setIsEnrollModalOpen(true);
            }}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs tracking-wide shadow-md shadow-amber-500/20 transition-all"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Enroll Station</span>
          </button>
        </div>
      </div>

      {/* Grid: Setup Checklist & Tenant Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Setup Checklist (§2) */}
        <div className="lg:col-span-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-amber-400" />
              <span>Setup Checklist</span>
            </h2>
            <span className="text-xs font-mono font-bold text-amber-400">
              {completedChecklistCount}/6 ({checklistPercent}%)
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-amber-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${checklistPercent}%` }}
            />
          </div>

          <div className="space-y-3 pt-2 text-xs">
            {/* 1. Tenant created */}
            <div className="flex items-center space-x-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="text-zinc-200">Tenant created</span>
            </div>

            {/* 2. Owner login created */}
            <div className="flex items-center space-x-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="text-zinc-200">Owner login provisioned</span>
            </div>

            {/* 3. Owner logged in */}
            <div className="flex items-center space-x-2.5">
              {checklist.ownerLoggedIn ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-zinc-600 flex-shrink-0" />
              )}
              <span className={checklist.ownerLoggedIn ? 'text-zinc-200' : 'text-zinc-400'}>
                Owner logged in & changed password
              </span>
            </div>

            {/* 4. First station enrolled */}
            <div className="flex items-center space-x-2.5">
              {checklist.stationEnrolled || stations.length > 0 ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-zinc-600 flex-shrink-0" />
              )}
              <span className={checklist.stationEnrolled || stations.length > 0 ? 'text-zinc-200' : 'text-zinc-400'}>
                First station enrolled
              </span>
            </div>

            {/* 5. Template uploaded */}
            <div className="flex items-center space-x-2.5">
              {checklist.templateUploaded ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-zinc-600 flex-shrink-0" />
              )}
              <span className={checklist.templateUploaded ? 'text-zinc-200' : 'text-zinc-400'}>
                Layout template uploaded
              </span>
            </div>

            {/* 6. First event created */}
            <div className="flex items-center space-x-2.5">
              {checklist.firstEventCreated ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-zinc-600 flex-shrink-0" />
              )}
              <span className={checklist.firstEventCreated ? 'text-zinc-200' : 'text-zinc-400'}>
                First event created
              </span>
            </div>
          </div>
        </div>

        {/* Plan Limits & Settings Overview */}
        <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
            <Layers className="w-4 h-4 text-blue-400" />
            <span>Tier Specifications & Limits</span>
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2">
            <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800">
              <div className="text-[11px] font-medium text-zinc-400">Max Stations</div>
              <div className="text-lg font-bold text-zinc-100 mt-0.5">
                {stations.length} / {tenant.limits?.maxStations ?? 1}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800">
              <div className="text-[11px] font-medium text-zinc-400">Daily Tx Cap</div>
              <div className="text-lg font-bold text-zinc-100 mt-0.5">
                {tenant.limits?.maxTransactionsPerDay ? `${tenant.limits.maxTransactionsPerDay}/day` : 'Unlimited'}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800">
              <div className="text-[11px] font-medium text-zinc-400">Cloud Storage Cap</div>
              <div className="text-lg font-bold text-zinc-100 mt-0.5">
                {tenant.limits?.maxStorageMb ?? 200} MB
              </div>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800">
              <div className="text-[11px] font-medium text-zinc-400">Soft-Copy QR</div>
              <div className="text-lg font-bold text-zinc-100 mt-0.5">
                {tenant.features?.softCopyQr ? (
                  <span className="text-emerald-400 flex items-center space-x-1">
                    <Check className="w-4 h-4" />
                    <span>Enabled</span>
                  </span>
                ) : (
                  <span className="text-zinc-500">Disabled</span>
                )}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800">
              <div className="text-[11px] font-medium text-zinc-400">Custom Layouts</div>
              <div className="text-lg font-bold text-zinc-100 mt-0.5">
                {tenant.limits?.maxCustomLayouts ?? 0} allowed
              </div>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800">
              <div className="text-[11px] font-medium text-zinc-400">Timezone</div>
              <div className="text-lg font-bold text-zinc-100 mt-0.5 font-mono text-sm truncate">
                {settings.timezone || 'UTC'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hardware Stations Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl space-y-4 p-6">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
          <div>
            <h2 className="text-base font-bold text-white flex items-center space-x-2">
              <Monitor className="w-5 h-5 text-amber-400" />
              <span>Hardware Stations ({stations.length})</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Registered photobooth PCs executing offline session captures and local compositor jobs.
            </p>
          </div>

          <button
            onClick={() => {
              setEnrollmentResult(null);
              setIsEnrollModalOpen(true);
            }}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 border border-zinc-700"
          >
            <PlusCircle className="w-3.5 h-3.5 text-amber-400" />
            <span>Enroll New Station</span>
          </button>
        </div>

        {stations.length === 0 ? (
          <div className="py-8 text-center text-zinc-500 space-y-3">
            <Monitor className="w-10 h-10 text-zinc-600 mx-auto" />
            <p className="text-sm text-zinc-300 font-medium">No stations enrolled yet</p>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto">
              Generate a one-time enrollment code to link a desktop booth PC with this studio tenant.
            </p>
            <button
              onClick={() => {
                setEnrollmentResult(null);
                setIsEnrollModalOpen(true);
              }}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs"
            >
              Enroll First Station
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                  <th scope="col" className="pb-3">Station Label</th>
                  <th scope="col" className="pb-3">Station ID</th>
                  <th scope="col" className="pb-3">Status</th>
                  <th scope="col" className="pb-3">Last Seen</th>
                  <th scope="col" className="pb-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-sm">
                {stations.map((s) => (
                  <tr key={s.id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="py-3 font-semibold text-zinc-100 flex items-center space-x-2">
                      <Monitor className="w-4 h-4 text-zinc-400" />
                      <span>{s.label}</span>
                    </td>
                    <td className="py-3 font-mono text-xs text-zinc-400">
                      {s.id}
                    </td>
                    <td className="py-3">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {s.status}
                      </span>
                    </td>
                    <td className="py-3 text-xs text-zinc-400">
                      {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : 'Never'}
                    </td>
                    <td className="py-3 text-xs text-zinc-400">
                      {new Date(s.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL 1: Change Plan */}
      {isPlanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <span>Change Subscription Tier</span>
              </h3>
              <button
                onClick={() => setIsPlanModalOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              {(['basic', 'plus', 'business'] as TenantPlan[]).map((p) => (
                <label
                  key={p}
                  className={`flex items-start justify-between p-4 rounded-xl border cursor-pointer transition-all ${
                    selectedNewPlan === p
                      ? 'bg-zinc-800 border-amber-500 ring-1 ring-amber-500'
                      : 'bg-zinc-950 border-zinc-800 hover:bg-zinc-800/50'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <input
                      type="radio"
                      name="plan"
                      value={p}
                      checked={selectedNewPlan === p}
                      onChange={() => setSelectedNewPlan(p)}
                      className="text-amber-500 focus:ring-amber-500"
                    />
                    <div>
                      <div className="text-sm font-bold text-white capitalize">{p} Plan</div>
                      <div className="text-xs text-zinc-400">
                        {p === 'basic' && 'Free · 1 station · 50 tx/day · No QR'}
                        {p === 'plus' && '₱999/mo · 3 stations · 100 tx/day · Soft-copy QR'}
                        {p === 'business' && '₱1,999/mo · 10 stations · Unlimited tx · Soft-copy QR'}
                      </div>
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setIsPlanModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-semibold hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleChangePlan}
                disabled={isUpdatingPlan}
                className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold shadow-md shadow-amber-500/20 disabled:opacity-50"
              >
                {isUpdatingPlan ? 'Updating...' : 'Confirm Plan Change'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Suspend / Reactivate Confirmation */}
      {isSuspendModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-amber-400">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" />
              <h3 className="text-lg font-bold text-white">
                {tenant.status === 'active' ? 'Suspend Photo Studio Tenant?' : 'Reactivate Photo Studio Tenant?'}
              </h3>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              {tenant.status === 'active' ? (
                <>
                  Suspending <strong className="text-white">{tenant.name}</strong> will revoke access for all booth operators, block offline grant issuance, and pause session publication. Existing customer galleries and privacy deletion sweeps remain intact (§6).
                </>
              ) : (
                <>
                  Reactivating <strong className="text-white">{tenant.name}</strong> will immediately restore booth login privileges and offline grant preparation.
                </>
              )}
            </p>

            <div className="flex justify-end space-x-3 pt-4 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setIsSuspendModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-semibold hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleToggleStatus}
                disabled={isUpdatingStatus}
                className={`px-5 py-2 rounded-lg text-xs font-bold disabled:opacity-50 ${
                  tenant.status === 'active'
                    ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950'
                }`}
              >
                {isUpdatingStatus
                  ? 'Processing...'
                  : tenant.status === 'active'
                  ? 'Confirm Suspension'
                  : 'Confirm Reactivation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Reset Owner Password Result */}
      {isPasswordModalOpen && generatedPassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                <KeyRound className="w-5 h-5 text-amber-400" />
                <span>Temporary Password Generated</span>
              </h3>
              <button
                onClick={() => setIsPasswordModalOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg">
              Give this temporary password to the studio owner. They will be forced to choose a new password on their next login.
            </p>

            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-400">New Temporary Password</label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  readOnly
                  value={generatedPassword}
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 font-mono text-sm font-bold text-amber-300 select-all"
                />
                <button
                  type="button"
                  onClick={() => handleCopy(generatedPassword, 'resetPass')}
                  className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-bold text-zinc-950 flex items-center space-x-1"
                >
                  {copiedKey === 'resetPass' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedKey === 'resetPass' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <div className="pt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setIsPasswordModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-zinc-800 text-xs font-semibold text-zinc-200 hover:bg-zinc-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Enroll Station */}
      {isEnrollModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                <Monitor className="w-5 h-5 text-amber-400" />
                <span>Enroll Photobooth Station</span>
              </h3>
              <button
                onClick={() => setIsEnrollModalOpen(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {enrollmentResult ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs leading-relaxed">
                  Station hardware registered! Enter this one-time code on the operator desktop app to complete activation.
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    One-Time Enrollment Code
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      readOnly
                      value={enrollmentResult.code}
                      className="flex-1 bg-zinc-950 border-2 border-amber-500/40 rounded-lg px-3.5 py-2.5 font-mono text-lg font-extrabold text-amber-400 text-center tracking-widest select-all"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopy(enrollmentResult.code, 'enrollCode')}
                      className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs flex items-center space-x-1"
                    >
                      {copiedKey === 'enrollCode' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      <span>{copiedKey === 'enrollCode' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <div className="flex items-center space-x-1 text-[11px] text-zinc-500 pt-1">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Expires in 24 hours ({new Date(enrollmentResult.expiresAt).toLocaleTimeString()})</span>
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEnrollModalOpen(false);
                      setEnrollmentResult(null);
                    }}
                    className="px-5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleEnrollStation} className="space-y-4">
                <div>
                  <label htmlFor="stationLabel" className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
                    Station Device Label *
                  </label>
                  <input
                    id="stationLabel"
                    type="text"
                    required
                    value={stationLabel}
                    onChange={(e) => setStationLabel(e.target.value)}
                    placeholder="e.g. Booth 1 - Main Ballroom"
                    className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Friendly label to identify this physical PC or booth enclosure.
                  </p>
                </div>

                <div className="flex justify-end space-x-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsEnrollModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-semibold hover:bg-zinc-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isEnrollingStation || !stationLabel.trim()}
                    className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold shadow-md shadow-amber-500/20 disabled:opacity-50"
                  >
                    {isEnrollingStation ? 'Generating Code...' : 'Generate Enrollment Code'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
