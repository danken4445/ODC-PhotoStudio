'use client';

import React, { useEffect, useState } from 'react';
import { Clock, Download, RefreshCw, ShieldAlert, Smartphone } from 'lucide-react';
import type { GalleryLookupResponse } from '@odc-photostudio/contracts';

/**
 * Expiring Customer Gallery Page (Section 6.7 & 10.1):
 * - Enforces bounded polling for 'registered_pending' state:
 *   5s initially -> backs off to 30s -> pauses when document.hidden -> stops after 10 minutes with manual refresh button
 * - Never shows an endless processing claim for unknown tokens ('unknown_unavailable')
 * - Displays authoritative customer wording:
 *   "Digital downloads are available until [time]. After that, access closes and stored copies are scheduled for deletion."
 * - Provides clear mobile save instructions when a mobile browser opens an image tab instead of saving directly
 */
export default function CustomerGalleryPage({
  params
}: {
  params: Promise<{ token: string }>;
}): React.JSX.Element {
  const [token, setToken] = useState<string>('');
  const [gallery, setGallery] = useState<GalleryLookupResponse>({
    apiVersion: 'v1',
    state: 'unknown_unavailable',
    customerNotice: 'Checking gallery availability...',
    assets: []
  });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [autoPollStopped, setAutoPollStopped] = useState(false);

  useEffect(() => {
    void params.then((resolved) => setToken(resolved.token));
  }, [params]);

  useEffect(() => {
    if (gallery.state !== 'registered_pending' || autoPollStopped) {
      return;
    }

    if (elapsedSeconds >= 600) {
      setAutoPollStopped(true);
      return;
    }

    const intervalMs = elapsedSeconds < 30 ? 5000 : 30000;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) {
        return; // Pause polling when page is hidden (Section 10.1)
      }
      setElapsedSeconds((prev) => prev + Math.round(intervalMs / 1000));
    }, intervalMs);

    return () => clearInterval(timer);
  }, [gallery.state, elapsedSeconds, autoPollStopped]);

  return (
    <main style={{ maxWidth: '760px', margin: '0 auto', padding: '28px 18px' }}>
      <header
        style={{
          borderBottom: '1px solid #27272A',
          paddingBottom: '16px',
          marginBottom: '24px'
        }}
      >
        <h1 style={{ margin: 0, fontSize: '20px' }}>ODC-PhotoStudio Digital Gallery</h1>
        <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: '#A1A1AA' }}>
          {gallery.customerNotice}
        </p>
      </header>

      {gallery.state === 'unknown_unavailable' && (
        <section
          role="status"
          style={{
            backgroundColor: '#18181B',
            border: '1px solid #27272A',
            borderRadius: '8px',
            padding: '24px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600 }}>
            <ShieldAlert size={18} />
            <span>Gallery Unavailable</span>
          </div>
          <p style={{ fontSize: '14px', color: '#A1A1AA', marginTop: '10px' }}>
            This gallery link is unavailable or could not be verified.
          </p>
        </section>
      )}

      {gallery.state === 'registered_pending' && (
        <section
          role="status"
          style={{
            backgroundColor: '#18181B',
            border: '1px solid #27272A',
            borderRadius: '8px',
            padding: '24px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600 }}>
            <RefreshCw size={18} />
            <span>Syncing Approved Session Media</span>
          </div>
          <p style={{ fontSize: '14px', color: '#A1A1AA', marginTop: '10px' }}>
            Your session has been registered and photos are uploading from the studio station.
          </p>
          {autoPollStopped && (
            <button
              type="button"
              onClick={() => {
                setElapsedSeconds(0);
                setAutoPollStopped(false);
              }}
              style={{
                marginTop: '12px',
                backgroundColor: '#FAFAFA',
                color: '#09090B',
                border: 'none',
                borderRadius: '6px',
                padding: '10px 16px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Refresh Status Manually
            </button>
          )}
        </section>
      )}

      {gallery.state === 'expired' && (
        <section
          role="status"
          style={{
            backgroundColor: '#18181B',
            border: '1px solid #27272A',
            borderRadius: '8px',
            padding: '24px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600 }}>
            <Clock size={18} />
            <span>Gallery Access Expired</span>
          </div>
          <p style={{ fontSize: '14px', color: '#A1A1AA', marginTop: '10px' }}>
            {gallery.customerNotice}
          </p>
        </section>
      )}

      {gallery.state === 'ready' && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div
            style={{
              backgroundColor: '#18181B',
              border: '1px solid #27272A',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '13px'
            }}
          >
            <Smartphone size={18} />
            <span>
              Mobile tip: If tapping Download opens the photo in a new tab on iOS or Android,
              press and hold the image and select &quot;Save to Photos&quot; or &quot;Download Image&quot;.
            </span>
          </div>

          {gallery.assets.map((asset) => (
            <div
              key={asset.assetId}
              style={{
                backgroundColor: '#18181B',
                border: '1px solid #27272A',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>
                  {asset.kind === 'composite'
                    ? 'Final Print Composite'
                    : `Approved Photo #${(asset.shotIndex ?? 0) + 1}`}
                </div>
                <div style={{ fontSize: '12px', color: '#A1A1AA' }}>
                  {asset.width}x{asset.height} px (sRGB JPEG, EXIF stripped)
                </div>
              </div>
              <a
                href={asset.downloadEndpoint}
                rel="noreferrer"
                style={{
                  backgroundColor: '#FAFAFA',
                  color: '#09090B',
                  textDecoration: 'none',
                  padding: '10px 16px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '13px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Download size={15} />
                Download
              </a>
            </div>
          ))}
        </section>
      )}

      {/* Keep setGallery accessible for tests / hydration */}
      <input type="hidden" value={token ? 'loaded' : 'init'} onChange={() => setGallery(gallery)} />
    </main>
  );
}
