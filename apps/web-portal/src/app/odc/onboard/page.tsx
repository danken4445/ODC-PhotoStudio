'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  UserPlus,
  Building2,
  Check,
  Copy,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Circle,
  QrCode,
  Monitor,
  HardDrive,
  Layers,
  Sparkles,
  Edit2,
  Lock,
  ExternalLink
} from 'lucide-react';
import type { TenantPlan, OnboardTenantResult } from '@odc-photostudio/contracts';

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export default function OdcOnboardPage(): React.JSX.Element {
  const router = useRouter();

  // Form State
  const [studioName, setStudioName] = useState('');
  const [slug, setSlug] = useState('');
  const [isManualSlug, setIsManualSlug] = useState(false);
  const [plan, setPlan] = useState<TenantPlan>('plus');
  const [ownerDisplayName, setOwnerDisplayName] = useState('');
  const [ownerLoginId, setOwnerLoginId] = useState('');
  const [isManualLoginId, setIsManualLoginId] = useState(false);
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardTenantResult | null>(null);

  // Copy Feedback State
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Auto-derive slug
  useEffect(() => {
    if (!isManualSlug) {
      const derived = deriveSlug(studioName);
      setSlug(derived);
    }
  }, [studioName, isManualSlug]);

  // Auto-suggest login ID from slug
  useEffect(() => {
    if (!isManualLoginId) {
      const cleanSlug = slug || 'studio';
      setOwnerLoginId(`owner@${cleanSlug}.odc.local`);
    }
  }, [slug, isManualLoginId]);

  const handleCopy = async (text: string, fieldKey: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldKey);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Clipboard fallback
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!studioName.trim()) {
      setError('Studio Name is required.');
      return;
    }

    if (!slug.trim() || !/^[a-z0-9-]+$/.test(slug)) {
      setError('Slug must only contain lowercase alphanumeric characters and hyphens.');
      return;
    }

    if (!ownerDisplayName.trim()) {
      setError('Owner Display Name is required.');
      return;
    }

    if (!ownerLoginId.trim()) {
      setError('Owner Login ID is required.');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch('/api/odc/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studioName: studioName.trim(),
          slug: slug.trim(),
          plan,
          ownerDisplayName: ownerDisplayName.trim(),
          ownerLoginId: ownerLoginId.trim(),
          contactPhone: contactPhone.trim() || undefined,
          notes: notes.trim() || undefined
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          throw new Error(`The slug "${slug}" is already taken by another studio. Please choose another.`);
        }
        throw new Error(data.error || 'Failed to onboard tenant studio.');
      }

      const onboardResult = (await res.json()) as OnboardTenantResult;
      setResult(onboardResult);
    } catch (err: any) {
      setError(err.message || 'An error occurred during onboarding.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // If successfully onboarded, show Post-Submit Result Screen
  if (result) {
    return (
      <div className="max-w-3xl mx-auto space-y-8 py-4">
        {/* Success Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 mb-2">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Client Successfully Onboarded!
          </h1>
          <p className="text-sm text-zinc-400">
            Studio <strong className="text-zinc-200">{result.studioName}</strong> ({result.slug}) has been provisioned on the{' '}
            <span className="capitalize font-semibold text-amber-400">{result.plan}</span> plan.
          </p>
        </div>

        {/* Prominent One-Time Credentials Warning */}
        <div className="p-5 rounded-2xl bg-amber-500/10 border-2 border-amber-500/30 text-amber-300 shadow-xl space-y-2">
          <div className="flex items-center space-x-2 font-bold text-amber-200">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-400" />
            <span>CRITICAL: Copy credentials immediately</span>
          </div>
          <p className="text-xs sm:text-sm text-amber-300/90 leading-relaxed">
            Copy these credentials now. The temporary password is shown <strong>once</strong> and cannot be viewed again.
            The owner will be required to change this password on their first sign in.
          </p>
        </div>

        {/* Credentials Box */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-2">
            Generated Studio Credentials
          </h2>

          {/* Login URL */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-400">Studio Login Portal URL</label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                readOnly
                value={result.loginUrl}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 font-mono text-xs text-zinc-200 select-all"
              />
              <button
                type="button"
                onClick={() => handleCopy(result.loginUrl, 'url')}
                className="px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 flex items-center space-x-1.5 transition-colors"
              >
                {copiedField === 'url' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                <span>{copiedField === 'url' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Username / Login ID */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-400">Username / Owner Login ID</label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                readOnly
                value={result.ownerLoginId}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 font-mono text-xs text-zinc-200 select-all"
              />
              <button
                type="button"
                onClick={() => handleCopy(result.ownerLoginId, 'loginId')}
                className="px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 flex items-center space-x-1.5 transition-colors"
              >
                {copiedField === 'loginId' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                <span>{copiedField === 'loginId' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Temporary Password */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-amber-400 flex items-center space-x-1">
              <Lock className="w-3.5 h-3.5" />
              <span>One-Time Temporary Password</span>
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                readOnly
                value={result.temporaryPassword}
                className="flex-1 bg-zinc-950 border-2 border-amber-500/40 rounded-lg px-3.5 py-2.5 font-mono text-sm font-bold text-amber-300 select-all tracking-wider"
              />
              <button
                type="button"
                onClick={() => handleCopy(result.temporaryPassword, 'password')}
                className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-bold text-zinc-950 flex items-center space-x-1.5 transition-colors shadow-md shadow-amber-500/20"
              >
                {copiedField === 'password' ? <Check className="w-4 h-4 text-zinc-950" /> : <Copy className="w-4 h-4" />}
                <span>{copiedField === 'password' ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Setup Checklist (§2) */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
              Onboarding & Setup Checklist
            </h2>
            <span className="text-xs text-zinc-500 font-mono">2 of 6 Completed</span>
          </div>

          <div className="divide-y divide-zinc-800/80">
            {/* 1. Tenant created */}
            <div className="py-3 flex items-center space-x-3 text-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <span className="text-zinc-200 line-through">Tenant created in database</span>
            </div>

            {/* 2. Owner login created */}
            <div className="py-3 flex items-center space-x-3 text-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <span className="text-zinc-200 line-through">Owner login credentials provisioned</span>
            </div>

            {/* 3. Owner has logged in and changed password */}
            <div className="py-3 flex items-center space-x-3 text-sm">
              <Circle className="w-5 h-5 text-zinc-600 flex-shrink-0" />
              <span className="text-zinc-400">Owner has logged in and changed temporary password</span>
            </div>

            {/* 4. First station enrolled */}
            <div className="py-3 flex items-center space-x-3 text-sm">
              <Circle className="w-5 h-5 text-zinc-600 flex-shrink-0" />
              <span className="text-zinc-400">First station hardware enrolled</span>
            </div>

            {/* 5. Template uploaded */}
            <div className="py-3 flex items-center space-x-3 text-sm">
              <Circle className="w-5 h-5 text-zinc-600 flex-shrink-0" />
              <span className="text-zinc-400">Photo layout template uploaded</span>
            </div>

            {/* 6. First event created */}
            <div className="py-3 flex items-center space-x-3 text-sm">
              <Circle className="w-5 h-5 text-zinc-600 flex-shrink-0" />
              <span className="text-zinc-400">First photo session event created</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <Link
            href={`/odc/tenants/${result.tenantId}`}
            className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-5 py-2.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-sm font-semibold text-zinc-200 transition-colors"
          >
            <span>Manage Studio</span>
            <ExternalLink className="w-4 h-4" />
          </Link>

          <Link
            href="/odc"
            className="w-full sm:w-auto inline-flex items-center justify-center space-x-2 px-6 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-sm tracking-wide shadow-md shadow-amber-500/20 transition-all"
          >
            <span>Go to Tenant Management</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 py-4">
      {/* Page Title */}
      <div className="pb-6 border-b border-zinc-800">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center space-x-3">
          <UserPlus className="w-7 h-7 text-amber-400" />
          <span>Client Onboarding</span>
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Provision a new commercial photo studio tenant with isolated storage, subscription tier, and owner access credentials.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-start space-x-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* 1. Studio Information */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <h2 className="text-base font-bold text-white flex items-center space-x-2">
            <Building2 className="w-5 h-5 text-amber-400" />
            <span>Studio Identity</span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Studio Name */}
            <div>
              <label htmlFor="studioName" className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
                Studio Name *
              </label>
              <input
                id="studioName"
                type="text"
                required
                value={studioName}
                onChange={(e) => setStudioName(e.target.value)}
                placeholder="e.g. Vintage Vault Studio"
                className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-colors"
              />
            </div>

            {/* Slug */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="slug" className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Tenant Slug *
                </label>
                <button
                  type="button"
                  onClick={() => setIsManualSlug(!isManualSlug)}
                  className="text-xs text-amber-400 hover:text-amber-300 flex items-center space-x-1"
                >
                  <Edit2 className="w-3 h-3" />
                  <span>{isManualSlug ? 'Auto-derive' : 'Edit manually'}</span>
                </button>
              </div>
              <div className="relative rounded-lg shadow-sm">
                <input
                  id="slug"
                  type="text"
                  required
                  readOnly={!isManualSlug}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  placeholder="vintage-vault-studio"
                  className={`w-full px-4 py-2.5 font-mono text-sm rounded-lg border focus:outline-none transition-colors ${
                    isManualSlug
                      ? 'bg-zinc-950 border-zinc-700 text-zinc-100 focus:ring-2 focus:ring-amber-500'
                      : 'bg-zinc-950/60 border-zinc-800 text-zinc-400 cursor-not-allowed'
                  }`}
                />
              </div>
              <p className="mt-1 text-[11px] text-zinc-500 font-mono">Format: ^[a-z0-9-]+$</p>
            </div>
          </div>
        </div>

        {/* 2. Plan Selection */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center space-x-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <span>Subscription Tier</span>
            </h2>
            <span className="text-xs text-zinc-400">Monthly billing in PHP</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Basic Card */}
            <div
              onClick={() => setPlan('basic')}
              className={`p-5 rounded-xl border cursor-pointer transition-all ${
                plan === 'basic'
                  ? 'bg-zinc-800/80 border-amber-500 ring-2 ring-amber-500/20 shadow-lg'
                  : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/40'
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-white text-base">Basic</h3>
                  <div className="text-xl font-extrabold text-zinc-200 mt-1">Free</div>
                </div>
                {plan === 'basic' && <Check className="w-5 h-5 text-amber-400" />}
              </div>
              <p className="text-xs text-zinc-400 mt-2">Single small booth testing.</p>

              <div className="mt-4 pt-4 border-t border-zinc-800/80 space-y-2 text-xs text-zinc-300">
                <div className="flex items-center space-x-2">
                  <Monitor className="w-3.5 h-3.5 text-zinc-400" />
                  <span><strong>1</strong> Station</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Layers className="w-3.5 h-3.5 text-zinc-400" />
                  <span><strong>50</strong> tx / day cap</span>
                </div>
                <div className="flex items-center space-x-2 text-zinc-500">
                  <QrCode className="w-3.5 h-3.5" />
                  <span>No soft-copy QR (print only)</span>
                </div>
                <div className="flex items-center space-x-2">
                  <HardDrive className="w-3.5 h-3.5 text-zinc-400" />
                  <span>200 MB concurrent storage</span>
                </div>
              </div>
            </div>

            {/* Plus Card */}
            <div
              onClick={() => setPlan('plus')}
              className={`p-5 rounded-xl border relative cursor-pointer transition-all ${
                plan === 'plus'
                  ? 'bg-zinc-800/80 border-amber-500 ring-2 ring-amber-500/20 shadow-lg'
                  : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/40'
              }`}
            >
              <div className="absolute -top-2.5 right-4 px-2 py-0.5 rounded-full bg-amber-500 text-zinc-950 text-[10px] font-extrabold tracking-wider uppercase shadow-sm">
                Recommended
              </div>
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-white text-base">Plus</h3>
                  <div className="text-xl font-extrabold text-amber-400 mt-1">
                    ₱999 <span className="text-xs font-normal text-zinc-400">/ mo</span>
                  </div>
                </div>
                {plan === 'plus' && <Check className="w-5 h-5 text-amber-400" />}
              </div>
              <p className="text-xs text-zinc-400 mt-2">Active studio with multiple events.</p>

              <div className="mt-4 pt-4 border-t border-zinc-800/80 space-y-2 text-xs text-zinc-300">
                <div className="flex items-center space-x-2">
                  <Monitor className="w-3.5 h-3.5 text-blue-400" />
                  <span><strong>3</strong> Stations</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Layers className="w-3.5 h-3.5 text-blue-400" />
                  <span><strong>100</strong> tx / day cap</span>
                </div>
                <div className="flex items-center space-x-2 text-emerald-400">
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Soft-copy QR & Gallery</span>
                </div>
                <div className="flex items-center space-x-2">
                  <HardDrive className="w-3.5 h-3.5 text-zinc-400" />
                  <span>1 GB concurrent storage</span>
                </div>
              </div>
            </div>

            {/* Business Card */}
            <div
              onClick={() => setPlan('business')}
              className={`p-5 rounded-xl border cursor-pointer transition-all ${
                plan === 'business'
                  ? 'bg-zinc-800/80 border-amber-500 ring-2 ring-amber-500/20 shadow-lg'
                  : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/40'
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-white text-base">Business</h3>
                  <div className="text-xl font-extrabold text-purple-400 mt-1">
                    ₱1,999 <span className="text-xs font-normal text-zinc-400">/ mo</span>
                  </div>
                </div>
                {plan === 'business' && <Check className="w-5 h-5 text-amber-400" />}
              </div>
              <p className="text-xs text-zinc-400 mt-2">Agencies & multi-booth commercial setups.</p>

              <div className="mt-4 pt-4 border-t border-zinc-800/80 space-y-2 text-xs text-zinc-300">
                <div className="flex items-center space-x-2">
                  <Monitor className="w-3.5 h-3.5 text-purple-400" />
                  <span><strong>10</strong> Stations</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Layers className="w-3.5 h-3.5 text-purple-400" />
                  <span><strong>Unlimited</strong> transactions</span>
                </div>
                <div className="flex items-center space-x-2 text-emerald-400">
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Soft-copy QR & Gallery</span>
                </div>
                <div className="flex items-center space-x-2">
                  <HardDrive className="w-3.5 h-3.5 text-zinc-400" />
                  <span>2 GB concurrent storage</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Owner Credentials */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <h2 className="text-base font-bold text-white flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            <span>Owner Account Provisioning</span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Owner Display Name */}
            <div>
              <label htmlFor="ownerDisplayName" className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
                Owner Display Name *
              </label>
              <input
                id="ownerDisplayName"
                type="text"
                required
                value={ownerDisplayName}
                onChange={(e) => setOwnerDisplayName(e.target.value)}
                placeholder="e.g. Maria Santos"
                className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-colors"
              />
            </div>

            {/* Owner Login ID */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="ownerLoginId" className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                  Owner Login ID (Email format) *
                </label>
                <button
                  type="button"
                  onClick={() => setIsManualLoginId(!isManualLoginId)}
                  className="text-xs text-amber-400 hover:text-amber-300 flex items-center space-x-1"
                >
                  <Edit2 className="w-3 h-3" />
                  <span>{isManualLoginId ? 'Auto-suggest' : 'Edit login ID'}</span>
                </button>
              </div>
              <input
                id="ownerLoginId"
                type="email"
                required
                value={ownerLoginId}
                onChange={(e) => {
                  setOwnerLoginId(e.target.value);
                  setIsManualLoginId(true);
                }}
                placeholder="owner@slug.odc.local"
                className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-colors"
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                Synthetic login used for Supabase Auth. No email verification message is sent.
              </p>
            </div>
          </div>
        </div>

        {/* 4. Contact & Notes (Optional) */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <h2 className="text-base font-bold text-white flex items-center space-x-2">
            <span>Additional Contact & Notes</span>
            <span className="text-xs font-normal text-zinc-500">(Optional)</span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="contactPhone" className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
                Contact Phone
              </label>
              <input
                id="contactPhone"
                type="text"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+63 917 123 4567"
                className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-colors"
              />
            </div>

            <div>
              <label htmlFor="notes" className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
                Admin Notes
              </label>
              <input
                id="notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Special agreements, hardware specs, etc."
                className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Submit Bar */}
        <div className="flex items-center justify-end space-x-4 pt-4">
          <Link
            href="/odc"
            className="px-5 py-2.5 rounded-lg border border-zinc-700 bg-zinc-800 text-sm font-semibold text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors"
          >
            Cancel
          </Link>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center space-x-2 px-6 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-sm tracking-wide shadow-md shadow-amber-500/20 hover:shadow-amber-500/30 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                <span>Onboarding Studio...</span>
              </>
            ) : (
              <>
                <span>Onboard Studio</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
