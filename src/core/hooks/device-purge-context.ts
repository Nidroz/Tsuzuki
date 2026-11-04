import { createContext } from 'react';

import type { ErrorReporter } from '../errors/error-reporter';
import type { DevicePurgeMarkers } from './device-purge-markers';

/** what the device purge needs besides the repositories and the query client (ADR-0018) */
export interface DevicePurgeValue {
  /** deletes the persisted query cache document: the persister's removeClient */
  readonly removePersistedCache: () => void | PromiseLike<void>;
  /** receives the purge steps that failed, and the sign out and account deletion failures */
  readonly reporter: ErrorReporter;
  /**
   * the purge-pending markers (ADR-0018, update of 2026-11-04), their failures reported to
   * `reporter`: written by the sign out and the DevicePurgeDriver, read by the driver at launch
   */
  readonly markers: DevicePurgeMarkers;
  /**
   * the number of purges since the provider mounted: a screen keyed with it remounts once a purge
   * ended, its state (search text, results, recent searches) gone
   */
  readonly generation: number;
  /** adds one to `generation`: the last step of each device-wide purge */
  readonly advanceGeneration: () => void;
}

/** the device purge wiring and its generation, set by DevicePurgeContextProvider */
export const DevicePurgeContext = createContext<DevicePurgeValue | null>(null);

export const MISSING_DEVICE_PURGE_PROVIDER_MESSAGE =
  'a device purge hook is used outside DevicePurgeContextProvider: render the tree inside DevicePurgeContextProvider';
