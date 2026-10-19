import { DisplaySettingsSchema, type DisplaySettings } from '@odc-photostudio/contracts';
import type { StationDatabase } from '../db.js';

export const DISPLAY_SETTINGS_CONFIG_KEY = 'customer_display_settings_v1';

export function loadDisplaySettings(db: StationDatabase): DisplaySettings {
  const raw = db.getStationConfig(DISPLAY_SETTINGS_CONFIG_KEY);
  if (!raw) {
    return DisplaySettingsSchema.parse({});
  }

  try {
    return DisplaySettingsSchema.parse(JSON.parse(raw));
  } catch {
    return DisplaySettingsSchema.parse({});
  }
}

export function saveDisplaySettings(
  db: StationDatabase,
  settings: DisplaySettings
): DisplaySettings {
  const validated = DisplaySettingsSchema.parse(settings);
  db.setStationConfig(DISPLAY_SETTINGS_CONFIG_KEY, JSON.stringify(validated));
  return validated;
}
