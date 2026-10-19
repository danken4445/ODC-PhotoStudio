import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StationDatabase } from '../src/main/db.js';
import {
  DISPLAY_SETTINGS_CONFIG_KEY,
  loadDisplaySettings,
  saveDisplaySettings
} from '../src/main/display/display-settings.js';

describe('customer display settings persistence', () => {
  let tempDir: string;
  let db: StationDatabase;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odc-display-settings-'));
    db = new StationDatabase(tempDir, '30000000-0000-4000-8000-000000000001');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses safe defaults when settings are absent or malformed', () => {
    expect(loadDisplaySettings(db).mode).toBe('off');
    expect(loadDisplaySettings(db).tabletPort).toBe(47_940);

    db.setStationConfig(DISPLAY_SETTINGS_CONFIG_KEY, '{broken-json');
    expect(loadDisplaySettings(db)).toMatchObject({
      mode: 'off',
      preferredWiredDisplay: null,
      tabletBindAddress: null,
      tabletPort: 47_940,
      mirroredLiveView: true
    });
  });

  it('round-trips validated settings under the versioned key', () => {
    const saved = saveDisplaySettings(db, {
      mode: 'both',
      preferredWiredDisplay: {
        fingerprint: 'studio-display-1920x1080',
        id: 2,
        label: 'Studio Display',
        bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
        size: { width: 1920, height: 1080 },
        scaleFactor: 1,
        rotation: 0,
        internal: false,
        primary: false
      },
      tabletBindAddress: '192.168.4.2',
      tabletPort: 47_940,
      mirroredLiveView: false
    });

    expect(saved.mode).toBe('both');
    expect(loadDisplaySettings(db)).toEqual(saved);
    expect(db.getStationConfig(DISPLAY_SETTINGS_CONFIG_KEY)).toBe(JSON.stringify(saved));
  });

  it('strips transient status and pairing fields before persistence', () => {
    saveDisplaySettings(db, {
      mode: 'tablet',
      preferredWiredDisplay: null,
      tabletBindAddress: '10.0.0.2',
      tabletPort: 47_940,
      mirroredLiveView: true,
      pairingUrl: 'http://10.0.0.2:47940/?token=secret',
      cookie: 'secret',
      wiredStatus: 'active'
    } as never);

    const raw = db.getStationConfig(DISPLAY_SETTINGS_CONFIG_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({
      mode: 'tablet',
      preferredWiredDisplay: null,
      tabletBindAddress: '10.0.0.2',
      tabletPort: 47_940,
      mirroredLiveView: true
    });
  });
});
