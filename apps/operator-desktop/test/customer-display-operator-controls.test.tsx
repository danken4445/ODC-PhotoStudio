// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplaySettingsPanel } from '../src/renderer/display-settings/DisplaySettingsPanel.js';
import { useOperatorStore } from '../src/renderer/store.js';

const target = {
  fingerprint: 'v1:customer',
  id: 2,
  label: 'Customer HDMI Display',
  bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
  size: { width: 1920, height: 1080 },
  scaleFactor: 1,
  rotation: 0,
  internal: false,
  primary: false
};

function overview(update: Record<string, unknown> = {}) {
  return {
    settings: {
      mode: 'both' as const,
      preferredWiredDisplay: target,
      tabletBindAddress: '192.168.1.20',
      tabletPort: 47940,
      mirroredLiveView: true
    },
    targets: [target],
    interfaces: [{ name: 'Wi-Fi', address: '192.168.1.20', internal: false }],
    wired: { state: 'active' as const, selectedFingerprint: target.fingerprint, error: null },
    tablet: {
      state: 'awaiting_pairing' as const,
      enabled: true,
      host: '192.168.1.20',
      port: 47940,
      pairingUrl: 'http://192.168.1.20:47940/pair?token=operator-only',
      pairingQrDataUrl: 'data:image/png;base64,cG5n',
      lastHeartbeatAt: null,
      error: null
    },
    metrics: {
      framesPublished: 120,
      framesDropped: 3,
      framesPerSecond: 12,
      lastFrameAgeMs: 24
    },
    ...update
  };
}

describe('DisplaySettingsPanel', () => {
  const actions = {
    setDisplayMode: vi.fn(),
    identifyDisplay: vi.fn(),
    openWiredDisplay: vi.fn(),
    closeWiredDisplay: vi.fn(),
    startTabletDisplay: vi.fn(),
    stopTabletDisplay: vi.fn(),
    resetTabletPairing: vi.fn(),
    refreshDisplayOverview: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useOperatorStore.setState({
      displayOverview: overview(),
      displayError: null,
      ...actions
    });
  });

  afterEach(cleanup);

  it('offers all modes with explicit Certified and BYOD guidance', () => {
    render(<DisplaySettingsPanel />);
    expect(screen.getByRole('radio', { name: 'Off' })).toBeVisible();
    expect(screen.getByRole('radio', { name: /Certified Wired Display/ })).toBeVisible();
    expect(screen.getByRole('radio', { name: /Bring Your Own Tablet/ })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Both' })).toBeChecked();
    expect(screen.getByText(/network quality affects BYOD latency/i)).toBeVisible();
    fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
    expect(actions.setDisplayMode).toHaveBeenCalledWith('off');
  });

  it('lists wired targets with keyboard-accessible Identify and Use actions', () => {
    render(<DisplaySettingsPanel />);
    expect(screen.getByText('Customer HDMI Display')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Identify Customer HDMI Display/ }));
    fireEvent.click(screen.getByRole('button', { name: /Use Customer HDMI Display/ }));
    expect(actions.identifyDisplay).toHaveBeenCalledWith(target.fingerprint);
    expect(actions.openWiredDisplay).toHaveBeenCalledWith(target.fingerprint);
  });

  it.each([
    ['ambiguous', 'Multiple matching displays found'],
    ['missing', 'Selected display is disconnected']
  ] as const)('shows text warning for %s wired state', (state, copy) => {
    useOperatorStore.setState({
      displayOverview: overview({ wired: { state, selectedFingerprint: target.fingerprint, error: null } })
    });
    render(<DisplaySettingsPanel />);
    expect(screen.getByRole('alert')).toHaveTextContent(copy);
  });

  it('starts BYOD on a selected private interface and editable port', () => {
    render(<DisplaySettingsPanel />);
    fireEvent.change(screen.getByLabelText('Tablet network interface'), {
      target: { value: '192.168.1.20' }
    });
    fireEvent.change(screen.getByLabelText('Tablet port'), { target: { value: '48000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start tablet display' }));
    expect(actions.startTabletDisplay).toHaveBeenCalledWith('192.168.1.20', 48000);
  });

  it('shows the QR and pairing URL only while awaiting pairing', () => {
    const { rerender } = render(<DisplaySettingsPanel />);
    expect(screen.getByAltText('Tablet pairing QR code')).toHaveAttribute(
      'src',
      'data:image/png;base64,cG5n'
    );
    expect(screen.getByRole('link', { name: 'Open tablet pairing link' })).toHaveAttribute(
      'href',
      expect.stringContaining('/pair?token=')
    );

    act(() => {
      useOperatorStore.setState({
        displayOverview: overview({
          tablet: {
            ...overview().tablet,
            state: 'paired',
            pairingUrl: null,
            pairingQrDataUrl: null,
            lastHeartbeatAt: '2026-10-20T00:00:00.000Z'
          }
        })
      });
    });
    rerender(<DisplaySettingsPanel />);
    expect(screen.queryByAltText('Tablet pairing QR code')).not.toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeVisible();
  });

  it('labels reconnecting/error states and exposes stop, reset, and diagnostics', () => {
    useOperatorStore.setState({
      displayOverview: overview({
        tablet: {
          ...overview().tablet,
          state: 'reconnecting',
          pairingUrl: null,
          pairingQrDataUrl: null
        }
      }),
      displayError: 'Tablet network unavailable'
    });
    render(<DisplaySettingsPanel />);
    expect(screen.getByText('Reconnecting')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Tablet network unavailable');
    expect(screen.getByText('12 fps')).toBeVisible();
    expect(screen.getByText('3 dropped')).toBeVisible();
    expect(screen.getByText('24 ms frame age')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reset tablet pairing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop tablet display' }));
    expect(actions.resetTabletPairing).toHaveBeenCalled();
    expect(actions.stopTabletDisplay).toHaveBeenCalled();
  });
});
