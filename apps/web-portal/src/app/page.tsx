import React from 'react';
import { Building2, Calendar, LayoutTemplate, ShieldCheck, Users } from 'lucide-react';

export default function TenantPortalPage(): React.JSX.Element {
  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 24px' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #27272A',
          paddingBottom: '20px',
          marginBottom: '28px'
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '24px' }}>ODC-PhotoStudio — Tenant Portal</h1>
          <p style={{ margin: '6px 0 0 0', color: '#A1A1AA', fontSize: '14px' }}>
            Multi-tenant event management, immutable template versioning, and offline station grants
          </p>
        </div>
        <div
          style={{
            backgroundColor: '#18181B',
            border: '1px solid #27272A',
            borderRadius: '6px',
            padding: '8px 14px',
            fontSize: '13px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Building2 size={16} />
          <span>Active Tenant: Studio Alpha (Explicit Selection)</span>
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '16px'
        }}
      >
        <section
          style={{
            backgroundColor: '#18181B',
            border: '1px solid #27272A',
            borderRadius: '8px',
            padding: '20px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <Calendar size={18} />
            <span>Events & Station Assignments</span>
          </div>
          <p style={{ fontSize: '13px', color: '#A1A1AA', marginTop: '10px' }}>
            Assign operators and stations to active events and issue 72-hour Ed25519 signed offline preparation grants.
          </p>
        </section>

        <section
          style={{
            backgroundColor: '#18181B',
            border: '1px solid #27272A',
            borderRadius: '8px',
            padding: '20px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <LayoutTemplate size={18} />
            <span>Immutable Template Versions</span>
          </div>
          <p style={{ fontSize: '13px', color: '#A1A1AA', marginTop: '10px' }}>
            Configure 4x6 postcard (1200x1800) and 2x6 strip (600x1800) layouts at 300 DPI with reserved 4-module quiet zone QR boxes.
          </p>
        </section>

        <section
          style={{
            backgroundColor: '#18181B',
            border: '1px solid #27272A',
            borderRadius: '8px',
            padding: '20px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <Users size={18} />
            <span>Staff & Role Matrix</span>
          </div>
          <p style={{ fontSize: '13px', color: '#A1A1AA', marginTop: '10px' }}>
            Enforce Owner, Admin, and Operator capabilities across database RLS policies and reconnect upload verification.
          </p>
        </section>

        <section
          style={{
            backgroundColor: '#18181B',
            border: '1px solid #27272A',
            borderRadius: '8px',
            padding: '20px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <ShieldCheck size={18} />
            <span>24-Hour Privacy Lifecycle</span>
          </div>
          <p style={{ fontSize: '13px', color: '#A1A1AA', marginTop: '10px' }}>
            Immediate download revocation at expiration and 5-minute scheduled Storage API cleanup sweeps with 15-minute SLA alerting.
          </p>
        </section>
      </div>
    </div>
  );
}
