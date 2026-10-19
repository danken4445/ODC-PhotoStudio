import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CustomerDisplaySnapshot } from '@odc-photostudio/contracts';
import {
  createCustomerDisplayTransport,
  type CustomerDisplayFrame,
  type CustomerDisplayTransport
} from './transport.js';
import { toCustomerDisplayViewModel } from './view-model.js';
import './customer-display.css';

interface CustomerDisplayAppProps {
  transport?: CustomerDisplayTransport;
}

interface DisplayedFrame {
  kind: CustomerDisplayFrame['meta']['kind'];
  sequence: number;
  url: string;
}

export function CustomerDisplayApp({ transport: suppliedTransport }: CustomerDisplayAppProps) {
  const transport = useMemo(
    () => suppliedTransport ?? createCustomerDisplayTransport(window.location),
    [suppliedTransport]
  );
  const [snapshot, setSnapshot] = useState<CustomerDisplaySnapshot | null>(null);
  const [frame, setFrame] = useState<DisplayedFrame | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );
  const snapshotRevision = useRef(-1);
  const frameSequence = useRef(-1);
  const frameUrl = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const acceptSnapshot = (candidate: CustomerDisplaySnapshot) => {
      if (!mounted || candidate.revision <= snapshotRevision.current) return;
      snapshotRevision.current = candidate.revision;
      setSnapshot(candidate);
      transport.ackSnapshot(candidate.revision);
    };
    const acceptFrame = (candidate: CustomerDisplayFrame) => {
      if (!mounted || candidate.meta.sequence <= frameSequence.current) return;
      frameSequence.current = candidate.meta.sequence;
      const blobBytes = new ArrayBuffer(candidate.jpeg.byteLength);
      new Uint8Array(blobBytes).set(candidate.jpeg);
      const nextUrl = URL.createObjectURL(new Blob([blobBytes], { type: 'image/jpeg' }));
      if (frameUrl.current) URL.revokeObjectURL(frameUrl.current);
      frameUrl.current = nextUrl;
      setFrame({ kind: candidate.meta.kind, sequence: candidate.meta.sequence, url: nextUrl });
      transport.ackFrame(candidate.meta.sequence);
    };
    const unsubscribeSnapshot = transport.onSnapshot(acceptSnapshot);
    const unsubscribeFrame = transport.onFrame(acceptFrame);
    void transport.getSnapshot().then(acceptSnapshot).catch(() => undefined);
    return () => {
      mounted = false;
      unsubscribeSnapshot();
      unsubscribeFrame();
      if (frameUrl.current) URL.revokeObjectURL(frameUrl.current);
      frameUrl.current = null;
      transport.close();
    };
  }, [transport]);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (snapshot?.phase === 'preview' || frame?.kind !== 'preview') return;
    if (frameUrl.current) URL.revokeObjectURL(frameUrl.current);
    frameUrl.current = null;
    setFrame(null);
  }, [snapshot?.phase, frame?.kind]);

  if (!snapshot) {
    return <main className="customer-display customer-display--loading" aria-busy="true" />;
  }

  const model = toCustomerDisplayViewModel(snapshot);
  const imageAlt = frame?.kind === 'preview' ? 'Captured photo preview' : 'Live camera view';
  const mainClasses = [
    'customer-display',
    'customer-display--portrait-safe',
    'customer-display--landscape-safe',
    `customer-display--${model.phase}`,
    model.phase === 'preview' && !prefersReducedMotion ? 'customer-display--shutter-flash' : '',
    prefersReducedMotion ? 'customer-display--reduced-motion' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <main className={mainClasses} data-phase={model.phase}>
      <div className="customer-display__stage" aria-hidden={frame ? undefined : true}>
        {frame ? (
          <img
            className={`customer-display__image ${
              frame.kind === 'live' && model.mirrorLiveView
                ? 'customer-display__image--mirrored'
                : ''
            }`}
            src={frame.url}
            alt={imageAlt}
          />
        ) : null}
        <div className="customer-display__guide" aria-hidden="true" />
      </div>

      <section className="customer-display__overlay" aria-label="Photo booth status">
        {model.countdownValue !== null ? (
          <div
            key={model.countdownValue}
            className="customer-display__countdown-pop"
            aria-live="assertive"
            aria-label={model.countdownLabel ?? undefined}
          >
            {model.countdownValue}
          </div>
        ) : null}
        <div className="customer-display__glass-badge" role="status" aria-live="polite">
          <strong>{model.message}</strong>
          {model.progress ? <span>{model.progress}</span> : null}
        </div>
      </section>
    </main>
  );
}
