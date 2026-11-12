import type { StorageAdapter } from '@core/repositories/storage-adapter';

import {
  KEY_CHECK_KEY,
  KEY_CHECK_VALUE,
  LEGACY_COPIED_MARKER_KEY,
  MIGRATED_MARKER_KEY,
  MIGRATED_MARKER_VALUE,
} from '../app-storage-instance';
import { STORAGE_INSTANCE_ID } from '../storage';
import { device, seedFile } from './app-storage-device';
import {
  CACHE_KEY,
  CACHE_VALUE,
  launch,
  LIBRARY_KEY,
  LIBRARY_VALUE,
  THEME_KEY,
  THEME_VALUE,
} from './app-storage-launch';

/**
 * the unencrypted instance of a previous version, for the migration tests over the fake device
 * (app-storage-device.ts, app-storage-launch.ts)
 */

// what an unencrypted instance of the previous version holds
export const LEGACY_VALUES: Readonly<Record<string, string>> = {
  [THEME_KEY]: THEME_VALUE,
  [LIBRARY_KEY]: LIBRARY_VALUE,
  [CACHE_KEY]: CACHE_VALUE,
};

/** the encrypted instance after a complete copy of LEGACY_VALUES. */
export const MIGRATED = {
  [KEY_CHECK_KEY]: KEY_CHECK_VALUE,
  ...LEGACY_VALUES,
  [MIGRATED_MARKER_KEY]: MIGRATED_MARKER_VALUE,
};

/** the encrypted instance reset after a complete copy, then marked done without a copy. */
export const MARKED_ONLY = {
  [KEY_CHECK_KEY]: KEY_CHECK_VALUE,
  [MIGRATED_MARKER_KEY]: MIGRATED_MARKER_VALUE,
};

/** the unencrypted instance after a complete copy: marked copied. */
export const COPIED_LEGACY = {
  ...LEGACY_VALUES,
  [LEGACY_COPIED_MARKER_KEY]: MIGRATED_MARKER_VALUE,
};

export const seedLegacy = (values: Readonly<Record<string, string | number>> = LEGACY_VALUES) => {
  seedFile(STORAGE_INSTANCE_ID, undefined, values);
};

/** one launch, and the native events it caused. */
export const launchWithEvents = (): { storage: StorageAdapter; events: string[] } => {
  const start = device.events.length;
  const storage = launch();
  return { storage, events: device.events.slice(start) };
};
