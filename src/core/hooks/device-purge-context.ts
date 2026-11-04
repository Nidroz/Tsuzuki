import { createContext } from 'react';

import type { ErrorReporter } from '../errors/error-reporter';

/** what the device purge needs besides the repositories and the query client (ADR-0018) */
export interface DevicePurgeValue {
  /** deletes the persisted query cache document: the persister's removeClient */
  readonly removePersistedCache: () => void | PromiseLike<void>;
  /** receives the purge steps that failed, and the sign out and account deletion failures */
  readonly reporter: ErrorReporter;
  /**
   * the number of purges since the provider mounted: a screen keyed with it remounts once a purge
   * ended, its state (search text, results, recent searches) gone
   */
  readonly generation: number;
  /** adds one to `generation`: the last step of each purge */
  readonly advanceGeneration: () => void;
}

/** the device purge wiring and its generation, set by DevicePurgeContextProvider */
export const DevicePurgeContext = createContext<DevicePurgeValue | null>(null);

export const MISSING_DEVICE_PURGE_PROVIDER_MESSAGE =
  'a device purge hook is used outside DevicePurgeContextProvider: render the tree inside DevicePurgeContextProvider';
