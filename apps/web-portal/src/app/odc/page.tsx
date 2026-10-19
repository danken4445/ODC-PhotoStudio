'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Users,
  UserPlus,
  Search,
  Filter,
  Monitor,
  Calendar,
  ChevronRight,
  RefreshCw,
  Building2,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import type { TenantPlan, TenantStatus } from '@odc-photostudio/contracts';

interface TenantItem {
  id: string;
  studioName?: string;
  name?: string;
  slug: string;
  plan: TenantPlan;
  status: TenantStatus;
  stationsCount?: number;
  stationCount?: number;
  eventsCount?: number;
  createdAt: string;
}

export default function OdcTenantsPage(): React.JSX.Element {
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TenantStatus>('all');
  const [planFilter, setPlanFilter] = useState<'all' | TenantPlan>('all');

  const fetchTenants = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/odc/tenants');
      if (!res.ok) {
        if (res.status === 404 || res.status === 401) {
          window.location.href = '/odc/login';
          return;
        }
        throw new Error('Failed to load tenants list.');
      }
      const data = await res.json();
      setTenants(data.tenants || []);
    } catch (err: any) {
      setError(err.message || 'An error occurred while loading tenants.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, []);

  const filteredTenants = useMemo(() => {
    return tenants.filter((tenant) => {
      const name = (tenant.studioName || tenant.name || '').toLowerCase();
      const slug = (tenant.slug || '').toLowerCase();
      const query = searchQuery.trim().toLowerCase();

      const matchesSearch = !query || name.includes(query) || slug.includes(query);
      const matchesStatus = statusFilter === 'all' || tenant.status === statusFilter;
      const matchesPlan = planFilter === 'all' || tenant.plan === planFilter;

      return matchesSearch && matchesStatus && matchesPlan;
    });
  }, [tenants, searchQuery, statusFilter, planFilter]);

  const stats = useMemo(() => {
    const total = tenants.length;
    const active = tenants.filter((t) => t.status === 'active').length;
    const suspended = tenants.filter((t) => t.status === 'suspended').length;
    const totalStations = tenants.reduce(
      (acc, t) => acc + (t.stationsCount ?? t.stationCount ?? 0),
      0
    );
    return { total, active, suspended, totalStations };
  }, [tenants]);

  const renderPlanBadge = (plan: TenantPlan) => {
    switch (plan) {
      case 'business':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
            Business
          </span>
        );
      case 'plus':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            Plus
          </span>
        );
      case 'basic':
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700">
            Basic
          </span>
        );
    }
  };

  const renderStatusBadge = (status: TenantStatus) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Active</span>
          </span>
        );
      case 'suspended':
        return (
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-3 h-3" />
            <span>Suspended</span>
          </span>
        );
      case 'closed':
        return (
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
            <XCircle className="w-3 h-3" />
            <span>Closed</span>
          </span>
        );
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-zinc-800">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center space-x-3">
            <span>Tenant Management</span>
            <span className="text-xs font-mono font-normal text-zinc-500 bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded-md">
              {tenants.length} Total
            </span>
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Manage photo studio clients, tiers, station hardware allocations, and lifecycle status.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={fetchTenants}
            disabled={isLoading}
            className="p-2.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
            title="Refresh list"
            aria-label="Refresh tenants"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <Link
            href="/odc/onboard"
            className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-sm tracking-wide shadow-md shadow-amber-500/20 hover:shadow-amber-500/30 transition-all active:scale-[0.98]"
          >
            <UserPlus className="w-4 h-4" />
            <span>Client Onboarding</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-4">
          <div className="text-xs font-medium text-zinc-400">Total Studios</div>
          <div className="text-2xl font-bold text-white mt-1">{stats.total}</div>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-4">
          <div className="text-xs font-medium text-emerald-400">Active Studios</div>
          <div className="text-2xl font-bold text-emerald-300 mt-1">{stats.active}</div>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-4">
          <div className="text-xs font-medium text-amber-400">Suspended Studios</div>
          <div className="text-2xl font-bold text-amber-300 mt-1">{stats.suspended}</div>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-4">
          <div className="text-xs font-medium text-blue-400">Active Hardware Stations</div>
          <div className="text-2xl font-bold text-blue-300 mt-1">{stats.totalStations}</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by studio name or slug..."
            className="w-full pl-10 pr-4 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-colors"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-zinc-400">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-zinc-400">Plan:</span>
            <select
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value as any)}
              className="bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              <option value="all">All Plans</option>
              <option value="basic">Basic</option>
              <option value="plus">Plus</option>
              <option value="business">Business</option>
            </select>
          </div>
        </div>
      </div>

      {/* Error notification */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Tenants Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/60 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                <th scope="col" className="px-6 py-3.5">Studio Name</th>
                <th scope="col" className="px-6 py-3.5">Slug</th>
                <th scope="col" className="px-6 py-3.5">Plan</th>
                <th scope="col" className="px-6 py-3.5">Status</th>
                <th scope="col" className="px-6 py-3.5">Stations</th>
                <th scope="col" className="px-6 py-3.5">Created Date</th>
                <th scope="col" className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-zinc-500">
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                      <span>Loading photo studio tenants...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-zinc-500">
                    <div className="max-w-sm mx-auto flex flex-col items-center">
                      <Building2 className="w-10 h-10 text-zinc-600 mb-3" />
                      <p className="text-zinc-300 font-medium">No tenants found</p>
                      <p className="text-xs text-zinc-500 mt-1">
                        {searchQuery || statusFilter !== 'all' || planFilter !== 'all'
                          ? 'Try adjusting your search criteria or filters.'
                          : 'Get started by onboarding your first photo studio client.'}
                      </p>
                      {!searchQuery && statusFilter === 'all' && planFilter === 'all' && (
                        <Link
                          href="/odc/onboard"
                          className="mt-4 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs"
                        >
                          Onboard First Client
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredTenants.map((tenant) => {
                  const studioName = tenant.studioName || tenant.name || 'Unnamed Studio';
                  const stationCount = tenant.stationsCount ?? tenant.stationCount ?? 0;

                  return (
                    <tr
                      key={tenant.id}
                      className="hover:bg-zinc-800/40 transition-colors group"
                    >
                      {/* Studio Name */}
                      <td className="px-6 py-4 font-medium text-zinc-100 flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700/60 flex items-center justify-center text-amber-400 flex-shrink-0 group-hover:border-amber-500/40 transition-colors">
                          <Building2 className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-white group-hover:text-amber-400 transition-colors">
                            {studioName}
                          </div>
                          <div className="text-xs text-zinc-500 font-mono">
                            {tenant.id.slice(0, 8)}...
                          </div>
                        </div>
                      </td>

                      {/* Slug */}
                      <td className="px-6 py-4">
                        <span className="font-mono text-xs text-zinc-300 bg-zinc-950 border border-zinc-800 px-2 py-1 rounded">
                          {tenant.slug}
                        </span>
                      </td>

                      {/* Plan */}
                      <td className="px-6 py-4">
                        {renderPlanBadge(tenant.plan)}
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4">
                        {renderStatusBadge(tenant.status)}
                      </td>

                      {/* Stations */}
                      <td className="px-6 py-4 text-zinc-300">
                        <div className="flex items-center space-x-1.5 text-xs">
                          <Monitor className="w-3.5 h-3.5 text-zinc-400" />
                          <span>{stationCount} {stationCount === 1 ? 'station' : 'stations'}</span>
                        </div>
                      </td>

                      {/* Created Date */}
                      <td className="px-6 py-4 text-xs text-zinc-400">
                        {formatDate(tenant.createdAt)}
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/odc/tenants/${tenant.id}`}
                          className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-200 hover:bg-amber-500 hover:text-zinc-950 transition-all border border-zinc-700 hover:border-amber-500 shadow-sm"
                        >
                          <span>Manage</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
