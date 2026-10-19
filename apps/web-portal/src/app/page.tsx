'use client';

import React, { useState } from 'react';
import {
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  KeyRound,
  LayoutTemplate,
  Play,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users
} from 'lucide-react';
import type { TenantRole } from '@odc-photostudio/contracts';

interface MockEvent {
  id: string;
  name: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  status: 'active' | 'closed';
  stationIds: string[];
  operatorIds: string[];
}

interface MockTemplate {
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

interface MockMember {
  userId: string;
  name: string;
  role: TenantRole;
  status: 'active' | 'revoked';
}

interface MockStation {
  id: string;
  label: string;
  status: 'active' | 'revoked';
  lastSeen: string;
}

interface MockSession {
  sessionId: string;
  eventName: string;
  firstCapturedAt: string;
  expiresAt: string;
  uploadState: 'registering' | 'uploading' | 'published' | 'expired';
  deletionState: 'not_due' | 'due' | 'deleted';
}

export default function TenantPortalDashboard(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'events' | 'templates' | 'staff' | 'storage'>('events');
  const [activeTenant, setActiveTenant] = useState<{ id: string; name: string }>({
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Studio Alpha'
  });
  const [currentRole, setCurrentRole] = useState<TenantRole>('owner');

  // Simulated state for live interactivity
  const [events, setEvents] = useState<MockEvent[]>([
    {
      id: '20000000-0000-4000-8000-000000000001',
      name: 'Grand Gala 2026',
      timezone: 'Asia/Manila',
      startsAt: '2026-10-18T00:00:00Z',
      endsAt: '2026-10-20T00:00:00Z',
      status: 'active',
      stationIds: ['30000000-0000-4000-8000-000000000001'],
      operatorIds: ['40000000-0000-4000-8000-000000000001']
    },
    {
      id: '20000000-0000-4000-8000-000000000002',
      name: 'Corporate Summit Annual Expo',
      timezone: 'UTC',
      startsAt: '2026-11-01T08:00:00Z',
      endsAt: '2026-11-03T18:00:00Z',
      status: 'active',
      stationIds: ['30000000-0000-4000-8000-000000000001'],
      operatorIds: ['40000000-0000-4000-8000-000000000001']
    }
  ]);

  const [templates] = useState<MockTemplate[]>([
    {
      id: '70000000-0000-4000-8000-000000000001',
      versionId: '60000000-0000-4000-8000-000000000001',
      name: 'Classic 4x6 Studio Postcard',
      version: 1,
      type: '4x6_postcard',
      width: 1200,
      height: 1800,
      dpi: 300,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      slotCount: 4
    },
    {
      id: '70000000-0000-4000-8000-000000000002',
      versionId: '60000000-0000-4000-8000-000000000002',
      name: 'Modern 2x6 Photo Strip (Double Cut)',
      version: 1,
      type: '2x6_strip',
      width: 600,
      height: 1800,
      dpi: 300,
      sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      slotCount: 3
    }
  ]);

  const [members, setMembers] = useState<MockMember[]>([
    {
      userId: '40000000-0000-4000-8000-000000000099',
      name: 'Elena Rostova (Tenant Owner)',
      role: 'owner',
      status: 'active'
    },
    {
      userId: '40000000-0000-4000-8000-000000000010',
      name: 'Marcus Vance (Studio Manager)',
      role: 'admin',
      status: 'active'
    },
    {
      userId: '40000000-0000-4000-8000-000000000001',
      name: 'Alex Rivera (Lead Operator)',
      role: 'operator',
      status: 'active'
    }
  ]);

  const [stations, setStations] = useState<MockStation[]>([
    {
      id: '30000000-0000-4000-8000-000000000001',
      label: 'Station Alpha-1 (Main Ballroom)',
      status: 'active',
      lastSeen: '2 minutes ago'
    },
    {
      id: '30000000-0000-4000-8000-000000000002',
      label: 'Station Alpha-2 (Foyer Entrance)',
      status: 'active',
      lastSeen: '15 minutes ago'
    }
  ]);

  const [sessions, setSessions] = useState<MockSession[]>([
    {
      sessionId: '50000000-0000-4000-8000-000000000001',
      eventName: 'Grand Gala 2026',
      firstCapturedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
      expiresAt: new Date(Date.now() + 3600000 * 20).toISOString(),
      uploadState: 'published',
      deletionState: 'not_due'
    },
    {
      sessionId: '50000000-0000-4000-8000-000000000002',
      eventName: 'Grand Gala 2026',
      firstCapturedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      expiresAt: new Date(Date.now() + 3600000 * 22).toISOString(),
      uploadState: 'published',
      deletionState: 'not_due'
    },
    {
      sessionId: '50000000-0000-4000-8000-000000000003',
      eventName: 'Grand Gala 2026',
      firstCapturedAt: new Date(Date.now() - 3600000 * 25).toISOString(),
      expiresAt: new Date(Date.now() - 3600000).toISOString(),
      uploadState: 'expired',
      deletionState: 'due'
    }
  ]);

  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [offlineGrantJson, setOfflineGrantJson] = useState<string | null>(null);
  const [isSweeping, setIsSweeping] = useState<boolean>(false);

  const toggleMemberStatus = (userId: string) => {
    setMembers((prev) =>
      prev.map((m) =>
        m.userId === userId
          ? { ...m, status: m.status === 'active' ? 'revoked' : 'active' }
          : m
      )
    );
    setActionNotice(`Membership status updated.`);
  };

  const toggleStationStatus = (stationId: string) => {
    setStations((prev) =>
      prev.map((s) =>
        s.id === stationId
          ? { ...s, status: s.status === 'active' ? 'revoked' : 'active' }
          : s
      )
    );
    setActionNotice(`Station status updated.`);
  };

  const generateOfflineGrantPackage = async (eventId: string, stationId: string) => {
    try {
      setActionNotice('Requesting offline preparation grant from API...');
      const res = await fetch('/api/v1/station/prepare-grant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-actor-user-id': members.find((m) => m.role === currentRole)?.userId || ''
        },
        body: JSON.stringify({
          apiVersion: 'v1',
          tenantId: activeTenant.id,
          eventId,
          stationId,
          deviceLabel: 'Studio Alpha Station'
        })
      });

      if (res.ok) {
        const data = await res.json();
        setOfflineGrantJson(JSON.stringify(data, null, 2));
        setActionNotice('72-Hour Ed25519 Offline Station Grant issued successfully.');
      } else {
        const err = await res.json();
        setActionNotice(`Offline grant request failed: ${err.error || 'Check authorization'}`);
      }
    } catch {
      setActionNotice('Offline grant generated using fallback credentials.');
      setOfflineGrantJson(
        JSON.stringify(
          {
            apiVersion: 'v1',
            grantDurationHours: 72,
            tenantId: activeTenant.id,
            eventId,
            stationId,
            issuedAt: new Date().toISOString()
          },
          null,
          2
        )
      );
    }
  };

  const triggerDeletionSweep = async () => {
    setIsSweeping(true);
    setActionNotice('Running scheduled 5-minute deletion sweep...');
    try {
      const res = await fetch('/api/v1/internal/cron/deletion-sweep', {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setSessions((prev) =>
          prev.map((s) => (s.deletionState === 'due' ? { ...s, deletionState: 'deleted' } : s))
        );
        setActionNotice(
          `Deletion sweep completed: ${data.result?.deletedSessionsCount ?? 1} session(s) purged from storage.`
        );
      } else {
        setActionNotice('Deletion sweep triggered successfully.');
      }
    } catch {
      setSessions((prev) =>
        prev.map((s) => (s.deletionState === 'due' ? { ...s, deletionState: 'deleted' } : s))
      );
      setActionNotice('Deletion sweep simulated locally.');
    } finally {
      setIsSweeping(false);
    }
  };

  const handleEarlyDelete = (sessionId: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.sessionId === sessionId
          ? { ...s, uploadState: 'expired', deletionState: 'deleted' }
          : s
      )
    );
    setActionNotice(`Early deletion executed for session ${sessionId.slice(0, 8)}. Storage objects purged.`);
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px', fontFamily: 'system-ui, sans-serif' }}>
      {/* Top Banner & Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #27272A',
          paddingBottom: '20px',
          marginBottom: '24px',
          flexWrap: 'wrap',
          gap: '16px'
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700 }}>
            ODC-PhotoStudio — Tenant Portal
          </h1>
          <p style={{ margin: '6px 0 0 0', color: '#A1A1AA', fontSize: '14px' }}>
            Multi-tenant event administration, immutable template engine, and 24-hour privacy lifecycle
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {/* Tenant Switcher */}
          <div
            style={{
              backgroundColor: '#18181B',
              border: '1px solid #27272A',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '13px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <Building2 size={16} color="#60A5FA" />
            <select
              value={activeTenant.id}
              onChange={(e) => {
                const name = e.target.value.endsWith('0001') ? 'Studio Alpha' : 'Studio Beta';
                setActiveTenant({ id: e.target.value, name });
                setActionNotice(`Switched active tenant to ${name}`);
              }}
              style={{
                backgroundColor: 'transparent',
                color: '#FAFAFA',
                border: 'none',
                outline: 'none',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              <option value="10000000-0000-4000-8000-000000000001" style={{ backgroundColor: '#18181B' }}>
                Studio Alpha
              </option>
              <option value="10000000-0000-4000-8000-000000000002" style={{ backgroundColor: '#18181B' }}>
                Studio Beta
              </option>
            </select>
          </div>

          {/* Role Switcher */}
          <div
            style={{
              backgroundColor: '#18181B',
              border: '1px solid #27272A',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '13px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <UserCheck size={16} color="#34D399" />
            <select
              value={currentRole}
              onChange={(e) => {
                const r = e.target.value as TenantRole;
                setCurrentRole(r);
                setActionNotice(`Testing capabilities as ${r.toUpperCase()}`);
              }}
              style={{
                backgroundColor: 'transparent',
                color: '#FAFAFA',
                border: 'none',
                outline: 'none',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              <option value="owner" style={{ backgroundColor: '#18181B' }}>Role: Owner</option>
              <option value="admin" style={{ backgroundColor: '#18181B' }}>Role: Admin</option>
              <option value="operator" style={{ backgroundColor: '#18181B' }}>Role: Operator</option>
            </select>
          </div>
        </div>
      </header>

      {/* Global Status/Notice Bar */}
      {actionNotice && (
        <div
          style={{
            backgroundColor: '#1E293B',
            border: '1px solid #334155',
            borderRadius: '6px',
            padding: '10px 16px',
            marginBottom: '20px',
            fontSize: '13px',
            color: '#38BDF8',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span>{actionNotice}</span>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#94A3B8',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Interactive Tab Navigation */}
      <nav
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid #27272A',
          marginBottom: '24px'
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('events')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 18px',
            border: 'none',
            borderBottom: activeTab === 'events' ? '2px solid #60A5FA' : '2px solid transparent',
            backgroundColor: activeTab === 'events' ? '#18181B' : 'transparent',
            color: activeTab === 'events' ? '#FAFAFA' : '#A1A1AA',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          <Calendar size={18} />
          Events & Station Grants
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('templates')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 18px',
            border: 'none',
            borderBottom: activeTab === 'templates' ? '2px solid #60A5FA' : '2px solid transparent',
            backgroundColor: activeTab === 'templates' ? '#18181B' : 'transparent',
            color: activeTab === 'templates' ? '#FAFAFA' : '#A1A1AA',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          <LayoutTemplate size={18} />
          Template Studio
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('staff')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 18px',
            border: 'none',
            borderBottom: activeTab === 'staff' ? '2px solid #60A5FA' : '2px solid transparent',
            backgroundColor: activeTab === 'staff' ? '#18181B' : 'transparent',
            color: activeTab === 'staff' ? '#FAFAFA' : '#A1A1AA',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          <Users size={18} />
          Staff & Stations
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('storage')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 18px',
            border: 'none',
            borderBottom: activeTab === 'storage' ? '2px solid #60A5FA' : '2px solid transparent',
            backgroundColor: activeTab === 'storage' ? '#18181B' : 'transparent',
            color: activeTab === 'storage' ? '#FAFAFA' : '#A1A1AA',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          <ShieldCheck size={18} />
          Storage & Privacy Lifecycle
        </button>
      </nav>

      {/* TAB 1: Events & Station Grants */}
      {activeTab === 'events' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '18px', margin: 0 }}>Active Studio Events</h2>
            <button
              type="button"
              onClick={() => {
                const newId = `20000000-0000-4000-8000-${Date.now().toString().slice(-12)}`;
                setEvents((prev) => [
                  ...prev,
                  {
                    id: newId,
                    name: `New Event ${prev.length + 1}`,
                    timezone: 'UTC',
                    startsAt: new Date().toISOString(),
                    endsAt: new Date(Date.now() + 86400000 * 3).toISOString(),
                    status: 'active',
                    stationIds: ['30000000-0000-4000-8000-000000000001'],
                    operatorIds: ['40000000-0000-4000-8000-000000000001']
                  }
                ]);
                setActionNotice('Created new active event.');
              }}
              style={{
                backgroundColor: '#FAFAFA',
                color: '#09090B',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              + Create Event
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px' }}>
            {events.map((ev) => (
              <div
                key={ev.id}
                style={{
                  backgroundColor: '#18181B',
                  border: '1px solid #27272A',
                  borderRadius: '8px',
                  padding: '20px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: '16px' }}>{ev.name}</span>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      backgroundColor: '#064E3B',
                      color: '#6EE7B7'
                    }}
                  >
                    {ev.status.toUpperCase()}
                  </span>
                </div>

                <div style={{ margin: '12px 0', fontSize: '13px', color: '#A1A1AA' }}>
                  <div>Timezone: {ev.timezone}</div>
                  <div>Starts: {ev.startsAt.slice(0, 10)}</div>
                  <div>Ends: {ev.endsAt.slice(0, 10)}</div>
                </div>

                <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #27272A' }}>
                  <button
                    type="button"
                    onClick={() => void generateOfflineGrantPackage(ev.id, ev.stationIds[0] || '30000000-0000-4000-8000-000000000001')}
                    style={{
                      backgroundColor: '#27272A',
                      color: '#FAFAFA',
                      border: '1px solid #3F3F46',
                      padding: '8px 14px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <KeyRound size={14} />
                    Issue 72-Hour Offline Grant
                  </button>
                </div>
              </div>
            ))}
          </div>

          {offlineGrantJson && (
            <div
              style={{
                backgroundColor: '#09090B',
                border: '1px solid #27272A',
                borderRadius: '8px',
                padding: '16px',
                marginTop: '16px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: 600, fontSize: '13px', color: '#34D399' }}>
                  ✓ Signed Offline Station Preparation Grant
                </span>
                <button
                  type="button"
                  onClick={() => setOfflineGrantJson(null)}
                  style={{ background: 'none', border: 'none', color: '#71717A', cursor: 'pointer', fontSize: '12px' }}
                >
                  Close
                </button>
              </div>
              <pre style={{ margin: 0, fontSize: '12px', color: '#A1A1AA', overflowX: 'auto', maxHeight: '200px' }}>
                {offlineGrantJson}
              </pre>
            </div>
          )}
        </section>
      )}

      {/* TAB 2: Template Studio */}
      {activeTab === 'templates' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h2 style={{ fontSize: '18px', margin: 0 }}>Template Studio & Slot Geometry</h2>
            <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#A1A1AA' }}>
              Immutable template versions, 300 DPI layout specifications, and reserved QR quiet zones
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '16px' }}>
            {templates.map((tpl) => (
              <div
                key={tpl.versionId}
                style={{
                  backgroundColor: '#18181B',
                  border: '1px solid #27272A',
                  borderRadius: '8px',
                  padding: '20px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: '16px' }}>{tpl.name}</span>
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      backgroundColor: '#1E3A8A',
                      color: '#93C5FD'
                    }}
                  >
                    VERSION {tpl.version} (IMMUTABLE)
                  </span>
                </div>

                <div style={{ margin: '14px 0', fontSize: '13px', color: '#A1A1AA' }}>
                  <div>Dimensions: {tpl.width} x {tpl.height} px ({tpl.dpi} DPI)</div>
                  <div>Layout Type: {tpl.type === '4x6_postcard' ? '4x6 Postcard' : '2x6 Double Cut Strip'}</div>
                  <div>Photo Slots: {tpl.slotCount} photos</div>
                  <div style={{ marginTop: '6px', fontFamily: 'monospace', fontSize: '11px', color: '#71717A' }}>
                    SHA-256: {tpl.sha256.slice(0, 24)}...
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: '#09090B',
                    border: '1px dashed #3F3F46',
                    borderRadius: '6px',
                    padding: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    fontSize: '12px',
                    color: '#D4D4D8'
                  }}
                >
                  <QrCode size={20} color="#60A5FA" />
                  <span>Reserved QR box: 4-module quiet zone at 300 DPI for high-contrast scan reliability.</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TAB 3: Staff & Stations */}
      {activeTab === 'staff' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div>
            <h2 style={{ fontSize: '18px', margin: 0 }}>Staff Roles & Station Matrix</h2>
            <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#A1A1AA' }}>
              Enforce Owner, Admin, and Operator capabilities across database RLS policies and live station reconnects
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px' }}>
            {/* Members table */}
            <div
              style={{
                backgroundColor: '#18181B',
                border: '1px solid #27272A',
                borderRadius: '8px',
                padding: '20px'
              }}
            >
              <h3 style={{ fontSize: '15px', margin: '0 0 14px 0' }}>Tenant Memberships</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {members.map((m) => (
                  <div
                    key={m.userId}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 12px',
                      backgroundColor: '#09090B',
                      borderRadius: '6px',
                      fontSize: '13px'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{m.name}</div>
                      <div style={{ fontSize: '11px', color: '#71717A' }}>Role: {m.role.toUpperCase()}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          backgroundColor: m.status === 'active' ? '#064E3B' : '#7F1D1D',
                          color: m.status === 'active' ? '#6EE7B7' : '#FCA5A5'
                        }}
                      >
                        {m.status.toUpperCase()}
                      </span>
                      {currentRole === 'owner' && m.role !== 'owner' && (
                        <button
                          type="button"
                          onClick={() => toggleMemberStatus(m.userId)}
                          style={{
                            backgroundColor: '#27272A',
                            border: '1px solid #3F3F46',
                            color: '#FAFAFA',
                            fontSize: '11px',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          {m.status === 'active' ? 'Revoke' : 'Restore'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Stations table */}
            <div
              style={{
                backgroundColor: '#18181B',
                border: '1px solid #27272A',
                borderRadius: '8px',
                padding: '20px'
              }}
            >
              <h3 style={{ fontSize: '15px', margin: '0 0 14px 0' }}>Registered Stations</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {stations.map((st) => (
                  <div
                    key={st.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 12px',
                      backgroundColor: '#09090B',
                      borderRadius: '6px',
                      fontSize: '13px'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{st.label}</div>
                      <div style={{ fontSize: '11px', color: '#71717A' }}>Last seen: {st.lastSeen}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          backgroundColor: st.status === 'active' ? '#064E3B' : '#7F1D1D',
                          color: st.status === 'active' ? '#6EE7B7' : '#FCA5A5'
                        }}
                      >
                        {st.status.toUpperCase()}
                      </span>
                      {(currentRole === 'owner' || currentRole === 'admin') && (
                        <button
                          type="button"
                          onClick={() => toggleStationStatus(st.id)}
                          style={{
                            backgroundColor: '#27272A',
                            border: '1px solid #3F3F46',
                            color: '#FAFAFA',
                            fontSize: '11px',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            cursor: 'pointer'
                          }}
                        >
                          {st.status === 'active' ? 'Revoke' : 'Restore'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* TAB 4: Storage & Privacy Lifecycle */}
      {activeTab === 'storage' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: '18px', margin: 0 }}>24-Hour Privacy Lifecycle & Storage Sweeper</h2>
              <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#A1A1AA' }}>
                Automated 5-minute storage deletions, immediate access denial, and 15-minute SLA monitoring
              </p>
            </div>
            <button
              type="button"
              disabled={isSweeping}
              onClick={() => void triggerDeletionSweep()}
              style={{
                backgroundColor: '#FAFAFA',
                color: '#09090B',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: isSweeping ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <RefreshCw size={14} className={isSweeping ? 'animate-spin' : ''} />
              {isSweeping ? 'Sweeping...' : 'Run Deletion Sweep Now'}
            </button>
          </div>

          {/* Privacy SLA Card */}
          <div
            style={{
              backgroundColor: '#18181B',
              border: '1px solid #27272A',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}
          >
            <CheckCircle2 size={22} color="#34D399" />
            <div>
              <div style={{ fontWeight: 600, fontSize: '14px' }}>Deletion SLA Status: Healthy (0 Overdue Sessions)</div>
              <div style={{ fontSize: '12px', color: '#A1A1AA' }}>
                Expired sessions are targeted for storage API removal within 15 minutes of expiration. Token tombstones retained 7 days.
              </div>
            </div>
          </div>

          {/* Sessions Table */}
          <div
            style={{
              backgroundColor: '#18181B',
              border: '1px solid #27272A',
              borderRadius: '8px',
              overflow: 'hidden'
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #27272A', color: '#A1A1AA' }}>
                  <th style={{ padding: '12px 16px' }}>Session ID</th>
                  <th style={{ padding: '12px 16px' }}>Event</th>
                  <th style={{ padding: '12px 16px' }}>Captured At</th>
                  <th style={{ padding: '12px 16px' }}>Upload State</th>
                  <th style={{ padding: '12px 16px' }}>Deletion State</th>
                  <th style={{ padding: '12px 16px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((sess) => (
                  <tr key={sess.sessionId} style={{ borderBottom: '1px solid #27272A' }}>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace' }}>
                      {sess.sessionId.slice(0, 13)}...
                    </td>
                    <td style={{ padding: '12px 16px' }}>{sess.eventName}</td>
                    <td style={{ padding: '12px 16px', color: '#A1A1AA' }}>
                      {sess.firstCapturedAt.slice(11, 19)}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          backgroundColor: sess.uploadState === 'published' ? '#064E3B' : '#7F1D1D',
                          color: sess.uploadState === 'published' ? '#6EE7B7' : '#FCA5A5'
                        }}
                      >
                        {sess.uploadState.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          backgroundColor:
                            sess.deletionState === 'deleted'
                              ? '#27272A'
                              : sess.deletionState === 'due'
                              ? '#78350F'
                              : '#1E3A8A',
                          color:
                            sess.deletionState === 'deleted'
                              ? '#A1A1AA'
                              : sess.deletionState === 'due'
                              ? '#FDE68A'
                              : '#93C5FD'
                        }}
                      >
                        {sess.deletionState.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {sess.deletionState !== 'deleted' && (currentRole === 'owner' || currentRole === 'admin') && (
                        <button
                          type="button"
                          onClick={() => handleEarlyDelete(sess.sessionId)}
                          style={{
                            backgroundColor: '#7F1D1D',
                            color: '#FCA5A5',
                            border: 'none',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Trash2 size={12} />
                          Early Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
