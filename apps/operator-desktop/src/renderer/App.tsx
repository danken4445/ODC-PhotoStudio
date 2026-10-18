import React, { useEffect } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  CloudUpload,
  HardDrive,
  LayoutGrid,
  Printer,
  RefreshCw,
  ShieldAlert,
  Wifi,
  WifiOff
} from 'lucide-react';
import { useOperatorStore } from './store.js';

export function OperatorCaptureApp(): React.JSX.Element {
  const store = useOperatorStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Suppress global shortcuts in inputs, dialogs, or key repeat (Section 14 / A18)
      if (event.repeat) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (store.isReprintModalOpen) {
        if (event.key === 'Escape') {
          store.setReprintModalOpen(false);
        }
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        if (store.captureState === 'created' || store.captureState === 'capturing') {
          store.triggerCaptureOrRetake();
        }
        return;
      }

      if (event.key >= '1' && event.key <= '9') {
        const index = Number(event.key) - 1;
        if (index < store.availableTemplates.length) {
          event.preventDefault();
          store.selectTemplateIndex(index);
        }
        return;
      }

      if (event.key.toLowerCase() === 'p') {
        if (store.captureState === 'approved' && store.compositeState === 'ready') {
          event.preventDefault();
          store.setReprintModalOpen(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store]);

  const currentTemplate = store.availableTemplates[store.selectedTemplateIndex];

  return (
    <div
      style={{
        backgroundColor: '#09090B',
        color: '#FAFAFA',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}
    >
      {/* Top Studio Header & Readiness Bar */}
      <header
        style={{
          backgroundColor: '#18181B',
          borderBottom: '1px solid #27272A',
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <strong style={{ fontSize: '18px', letterSpacing: '-0.02em' }}>
            ODC-PhotoStudio
          </strong>
          <span
            style={{
              backgroundColor: '#27272A',
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '12px'
            }}
          >
            Station: ST-01
          </span>
          {store.simulationLabel && (
            <span
              role="status"
              style={{
                backgroundColor: '#422006',
                border: '1px solid #CA8A04',
                color: '#FEF08A',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <AlertTriangle size={14} />
              {store.simulationLabel}
            </span>
          )}
        </div>

        {/* Status Indicators with both Icon + Text Label (No color-only status per Section 14) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '13px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <CheckCircle2 size={15} />
            {store.readyOffline ? 'Ready offline' : 'Preflight required'}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Camera size={15} />
            {store.cameraReady ? 'Camera: Ready' : 'Camera: Disconnected'}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Printer size={15} />
            {store.printerReady ? 'Printer: Ready' : 'Printer: Check Device'}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            {store.networkOnline ? <Wifi size={15} /> : <WifiOff size={15} />}
            {store.networkOnline ? 'Network: Online' : 'Network: Offline (Local Mode)'}
          </span>
          <button
            type="button"
            onClick={() => store.setSyncDrawerOpen(!store.isSyncDrawerOpen)}
            style={{
              backgroundColor: '#27272A',
              color: '#FAFAFA',
              border: '1px solid #3F3F46',
              borderRadius: '6px',
              padding: '6px 12px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <CloudUpload size={15} />
            Sync Queue ({store.syncQueue.length})
          </button>
        </div>
      </header>

      {/* Actionable System Warnings (Disk Low, Auth Expired, Clock Jump) */}
      {(!store.diskSpaceOk || store.authExpired || !store.clockHealthy) && (
        <div
          role="alert"
          style={{
            backgroundColor: '#3F1D1D',
            borderBottom: '1px solid #7F1D1D',
            padding: '10px 20px',
            display: 'flex',
            gap: '20px',
            fontSize: '13px'
          }}
        >
          {!store.diskSpaceOk && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <HardDrive size={15} />
              Disk Space Insufficient: New captures blocked to preserve pending session uploads.
            </span>
          )}
          {store.authExpired && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <ShieldAlert size={15} />
              Cloud Auth Expired: Local capture and printing remain active under offline grant; background upload paused.
            </span>
          )}
          {!store.clockHealthy && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Clock size={15} />
              {store.clockWarningReason ?? 'Clock Drift Detected: Reconcile server time before cloud publication.'}
            </span>
          )}
        </div>
      )}

      {/* Main Landscape Workspace */}
      <main
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '280px 1fr 340px',
          gap: '16px',
          padding: '16px'
        }}
      >
        {/* Left Column: Layout Selection */}
        <section
          aria-label="Layout Selection"
          style={{
            backgroundColor: '#18181B',
            border: '1px solid #27272A',
            borderRadius: '8px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <LayoutGrid size={16} />
            <span>Layout Templates (Keys 1-9)</span>
          </div>
          {store.availableTemplates.map((tpl, idx) => {
            const selected = idx === store.selectedTemplateIndex;
            return (
              <button
                key={tpl.templateVersionId}
                type="button"
                onClick={() => store.selectTemplateIndex(idx)}
                style={{
                  textAlign: 'left',
                  padding: '14px',
                  borderRadius: '6px',
                  backgroundColor: selected ? '#27272A' : '#09090B',
                  border: selected ? '2px solid #FAFAFA' : '1px solid #27272A',
                  color: '#FAFAFA',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '14px' }}>
                  [{idx + 1}] {tpl.name}
                </div>
                <div style={{ fontSize: '12px', color: '#A1A1AA', marginTop: '4px' }}>
                  {tpl.paperLabel} | {tpl.requiredShots} Required Shots
                </div>
              </button>
            );
          })}
        </section>

        {/* Center Column: Live View & Shot Thumbnails */}
        <section
          aria-label="Live View and Capture"
          style={{
            backgroundColor: '#18181B',
            border: '1px solid #27272A',
            borderRadius: '8px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}
        >
          <div
            style={{
              backgroundColor: '#09090B',
              border: '1px solid #27272A',
              borderRadius: '6px',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '340px'
            }}
          >
            <Camera size={40} />
            <p style={{ marginTop: '12px', fontSize: '15px', fontWeight: 500 }}>
              {store.captureState === 'approved'
                ? 'Session Approved — Ready for Local Print'
                : `Active Layout: ${currentTemplate?.name ?? ''}`}
            </p>
            <p style={{ fontSize: '13px', color: '#A1A1AA' }}>
              Capture State: {store.captureState.toUpperCase()} | Composite State:{' '}
              {store.compositeState.toUpperCase()}
            </p>
          </div>

          {/* Shot Thumbnails & Individual Retake Controls */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${store.shotSlots.length}, 1fr)`,
              gap: '12px',
              marginTop: '16px'
            }}
          >
            {store.shotSlots.map((slot) => (
              <div
                key={slot.frameIndex}
                style={{
                  backgroundColor: '#09090B',
                  border: '1px solid #27272A',
                  borderRadius: '6px',
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minHeight: '130px'
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 600 }}>
                  Frame {slot.frameIndex + 1}
                </div>
                <div style={{ fontSize: '12px', color: '#A1A1AA', margin: '8px 0' }}>
                  {slot.assetId ? 'Captured (sRGB)' : 'Pending capture'}
                </div>
                {slot.assetId && store.captureState !== 'approved' && (
                  <button
                    type="button"
                    onClick={() => store.triggerCaptureOrRetake(slot.frameIndex)}
                    style={{
                      backgroundColor: '#27272A',
                      color: '#FAFAFA',
                      border: '1px solid #3F3F46',
                      borderRadius: '4px',
                      padding: '6px 8px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <RefreshCw size={12} />
                    Retake Frame {slot.frameIndex + 1}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Right Column: Capture, Approval & Print Controls */}
        <section
          aria-label="Session Controls"
          style={{
            backgroundColor: '#18181B',
            border: '1px solid #27272A',
            borderRadius: '8px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}
        >
          <div style={{ fontWeight: 600, fontSize: '15px' }}>Operator Actions</div>

          <button
            type="button"
            disabled={
              store.isBusyCapturing ||
              store.captureState === 'approved' ||
              !store.diskSpaceOk ||
              !store.cameraReady
            }
            onClick={() => store.triggerCaptureOrRetake()}
            style={{
              backgroundColor: '#FAFAFA',
              color: '#09090B',
              border: 'none',
              borderRadius: '6px',
              padding: '14px',
              fontSize: '15px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Capture Shot (Space)
          </button>

          <button
            type="button"
            disabled={store.captureState !== 'reviewing'}
            onClick={() => store.approveSession()}
            style={{
              backgroundColor: store.captureState === 'reviewing' ? '#27272A' : '#09090B',
              color: '#FAFAFA',
              border: '1px solid #3F3F46',
              borderRadius: '6px',
              padding: '14px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: store.captureState === 'reviewing' ? 'pointer' : 'not-allowed'
            }}
          >
            Approve & Composite Print
          </button>

          <button
            type="button"
            disabled={
              store.captureState !== 'approved' ||
              store.compositeState !== 'ready' ||
              store.printState === 'unknown'
            }
            onClick={() => store.submitPrint(false)}
            style={{
              backgroundColor:
                store.captureState === 'approved' && store.compositeState === 'ready'
                  ? '#27272A'
                  : '#09090B',
              color: '#FAFAFA',
              border: '1px solid #3F3F46',
              borderRadius: '6px',
              padding: '14px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Print Local Copy
          </button>

          <button
            type="button"
            disabled={store.captureState !== 'approved' || store.compositeState !== 'ready'}
            onClick={() => store.setReprintModalOpen(true)}
            style={{
              backgroundColor: '#09090B',
              color: '#FAFAFA',
              border: '1px solid #27272A',
              borderRadius: '6px',
              padding: '12px',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            Reprint Approved Composite (P)
          </button>

          {store.printMessage && (
            <div
              role="status"
              style={{
                backgroundColor: '#09090B',
                border: '1px solid #27272A',
                borderRadius: '6px',
                padding: '12px',
                fontSize: '13px'
              }}
            >
              <strong>Print Status:</strong> {store.printMessage}
            </div>
          )}

          {store.printState === 'unknown' && (
            <div
              role="alert"
              style={{
                backgroundColor: '#422006',
                border: '1px solid #CA8A04',
                borderRadius: '6px',
                padding: '12px',
                fontSize: '13px'
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '8px' }}>
                Outcome unknown — inspect physical printer before attempting a new print
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => store.resolveUnknownPrint('confirmed')}
                  style={{ padding: '6px 10px', cursor: 'pointer' }}
                >
                  Mark Printed
                </button>
                <button
                  type="button"
                  onClick={() => store.resolveUnknownPrint('failed')}
                  style={{ padding: '6px 10px', cursor: 'pointer' }}
                >
                  Mark Failed
                </button>
              </div>
            </div>
          )}

          <hr style={{ borderColor: '#27272A', margin: '8px 0' }} />

          <button
            type="button"
            onClick={() => store.startNextSession()}
            style={{
              backgroundColor: '#27272A',
              color: '#FAFAFA',
              border: '1px solid #3F3F46',
              borderRadius: '6px',
              padding: '12px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Next Customer Session (Clears Screen, Keeps Sync Queue)
          </button>
        </section>
      </main>

      {/* Reprint Confirmation Modal (Shortcut P) */}
      {store.isReprintModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Reprint"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(9, 9, 11, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div
            style={{
              backgroundColor: '#18181B',
              border: '1px solid #27272A',
              borderRadius: '8px',
              padding: '24px',
              maxWidth: '420px',
              width: '100%'
            }}
          >
            <h2 style={{ margin: '0 0 12px 0', fontSize: '18px' }}>
              Confirm Audited Reprint
            </h2>
            <p style={{ fontSize: '14px', color: '#A1A1AA', marginBottom: '20px' }}>
              This creates a new audited print attempt using the existing approved composite.
              It does not create a new gallery or extend the 24-hour expiration deadline.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => store.setReprintModalOpen(false)}
                style={{
                  backgroundColor: '#09090B',
                  color: '#FAFAFA',
                  border: '1px solid #27272A',
                  borderRadius: '6px',
                  padding: '8px 14px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => store.submitPrint(true)}
                style={{
                  backgroundColor: '#FAFAFA',
                  color: '#09090B',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '8px 14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Submit Reprint
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
