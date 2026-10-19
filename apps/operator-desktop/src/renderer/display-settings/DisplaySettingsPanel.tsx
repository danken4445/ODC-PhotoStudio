import React, { useEffect, useState } from 'react';
import type { DisplayMode, TabletDisplayStatus } from '@odc-photostudio/contracts';
import { useOperatorStore } from '../store.js';
import './display-settings.css';

const MODE_OPTIONS: Array<{ value: DisplayMode; label: string; detail: string }> = [
  { value: 'off', label: 'Off', detail: 'No customer-facing display' },
  {
    value: 'wired',
    label: 'Certified Wired Display',
    detail: 'Lowest latency and the recommended event setup'
  },
  {
    value: 'tablet',
    label: 'Bring Your Own Tablet',
    detail: 'Offline local Wi-Fi display for an existing tablet'
  },
  { value: 'both', label: 'Both', detail: 'Run certified wired and BYOD together' }
];

function tabletStatusCopy(tablet: TabletDisplayStatus): string {
  switch (tablet.state) {
    case 'paired':
      return 'Connected';
    case 'reconnecting':
      return 'Reconnecting';
    case 'awaiting_pairing':
      return 'Waiting for tablet pairing';
    case 'listening':
      return 'Tablet server ready';
    case 'error':
      return 'Tablet display error';
    default:
      return 'Stopped';
  }
}

export function DisplaySettingsPanel(): React.JSX.Element {
  const store = useOperatorStore();
  const overview = store.displayOverview;
  const [host, setHost] = useState('');
  const [port, setPort] = useState(47_940);

  useEffect(() => {
    if (!overview) return;
    setHost(
      overview.settings.tabletBindAddress ?? overview.interfaces.find((item) => !item.internal)?.address ?? overview.interfaces[0]?.address ?? ''
    );
    setPort(overview.settings.tabletPort);
  }, [overview?.settings.tabletBindAddress, overview?.settings.tabletPort, overview?.interfaces]);

  if (!overview) {
    return (
      <section className="display-settings" aria-label="Customer display settings">
        <p>Customer display settings are unavailable.</p>
        <button type="button" onClick={() => void store.refreshDisplayOverview()}>
          Retry
        </button>
      </section>
    );
  }

  const { settings, targets, wired, tablet, metrics } = overview;
  const pairingVisible =
    tablet.state === 'awaiting_pairing' &&
    tablet.pairingUrl !== null &&
    tablet.pairingQrDataUrl !== null;

  return (
    <section className="display-settings" aria-label="Customer display settings">
      <div className="display-settings__heading">
        <div>
          <h2>Customer Display</h2>
          <p>Mirror the DSLR view with booth countdown and status overlays.</p>
        </div>
        <button type="button" onClick={() => void store.refreshDisplayOverview()}>
          Refresh status
        </button>
      </div>

      {store.displayError ? <div role="alert" className="display-settings__alert">{store.displayError}</div> : null}

      <fieldset className="display-settings__modes">
        <legend>Operating mode</legend>
        {MODE_OPTIONS.map((option) => (
          <label key={option.value} className="display-settings__mode">
            <input
              type="radio"
              name="customer-display-mode"
              aria-label={option.label}
              value={option.value}
              checked={settings.mode === option.value}
              onChange={() => void store.setDisplayMode(option.value)}
            />
            <span>
              <strong>{option.label}</strong>
              <small>{option.detail}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="display-settings__grid">
        <section className="display-settings__card" aria-labelledby="wired-display-title">
          <div className="display-settings__card-heading">
            <h3 id="wired-display-title">Wired displays</h3>
            <span className={`display-settings__status display-settings__status--${wired.state}`}>
              {wired.state}
            </span>
          </div>
          {wired.state === 'ambiguous' ? (
            <div role="alert" className="display-settings__alert">
              Multiple matching displays found. Choose the intended display again.
            </div>
          ) : null}
          {wired.state === 'missing' ? (
            <div role="alert" className="display-settings__alert">
              Selected display is disconnected. Reconnect it or choose another display.
            </div>
          ) : null}
          <div className="display-settings__targets">
            {targets.length === 0 ? <p>No displays detected.</p> : null}
            {targets.map((target) => (
              <div key={target.fingerprint} className="display-settings__target">
                <div>
                  <strong>{target.label}</strong>
                  <small>
                    {target.size.width}×{target.size.height}
                    {target.primary ? ' · Primary' : ''}
                    {target.internal ? ' · Internal' : ' · External'}
                  </small>
                </div>
                <div className="display-settings__actions">
                  <button
                    type="button"
                    aria-label={`Identify ${target.label}`}
                    onClick={() => void store.identifyDisplay(target.fingerprint)}
                  >
                    Identify
                  </button>
                  <button
                    type="button"
                    aria-label={`Use ${target.label}`}
                    onClick={() => void store.openWiredDisplay(target.fingerprint)}
                  >
                    Use
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => void store.closeWiredDisplay()}>
            Close wired display
          </button>
        </section>

        <section className="display-settings__card" aria-labelledby="tablet-display-title">
          <div className="display-settings__card-heading">
            <h3 id="tablet-display-title">Bring Your Own Tablet</h3>
            <span className={`display-settings__status display-settings__status--${tablet.state}`}>
              {tabletStatusCopy(tablet)}
            </span>
          </div>
          <p className="display-settings__caveat">
            Network quality affects BYOD latency. Use the certified wired mode for the most consistent live view.
          </p>
          <div className="display-settings__network-row">
            <label>
              Tablet network interface
              <select value={host} onChange={(event) => setHost(event.target.value)}>
                {overview.interfaces.map((item) => (
                  <option key={`${item.name}-${item.address}`} value={item.address}>
                    {item.name} — {item.address}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tablet port
              <input
                type="number"
                min={1024}
                max={65535}
                value={port}
                onChange={(event) => setPort(Number(event.target.value))}
              />
            </label>
          </div>
          <div className="display-settings__actions">
            <button
              type="button"
              disabled={!host || port < 1024 || port > 65535}
              onClick={() => void store.startTabletDisplay(host, port)}
            >
              Start tablet display
            </button>
            <button type="button" onClick={() => void store.resetTabletPairing()}>
              Reset tablet pairing
            </button>
            <button type="button" onClick={() => void store.stopTabletDisplay()}>
              Stop tablet display
            </button>
          </div>
          {pairingVisible ? (
            <div className="display-settings__pairing">
              <img src={tablet.pairingQrDataUrl!} alt="Tablet pairing QR code" />
              <a href={tablet.pairingUrl!} target="_blank" rel="noreferrer">
                Open tablet pairing link
              </a>
              <small>The pairing link expires after 10 minutes and works once.</small>
            </div>
          ) : null}
        </section>
      </div>

      <dl className="display-settings__diagnostics" aria-label="Display stream diagnostics">
        <div><dt>Frame rate</dt><dd>{metrics.framesPerSecond} fps</dd></div>
        <div><dt>Dropped</dt><dd>{metrics.framesDropped} dropped</dd></div>
        <div><dt>Latency</dt><dd>{metrics.lastFrameAgeMs === null ? 'No frame' : `${metrics.lastFrameAgeMs} ms frame age`}</dd></div>
      </dl>
    </section>
  );
}
