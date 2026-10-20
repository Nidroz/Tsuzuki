// an in-memory StorageAdapter for the local repository tests, its values open to inspection
import { jest } from '@jest/globals';

import type { ErrorReporter } from '../../../errors/error-reporter';
import type { StorageAdapter } from '../../storage-adapter';

export interface MemoryStorage extends StorageAdapter {
  readonly values: Map<string, string>;
}

export const createMemoryStorage = (): MemoryStorage => {
  const values = new Map<string, string>();
  return {
    values,
    getString: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
    delete: (key) => {
      values.delete(key);
    },
  };
};

/** an ErrorReporter recording its calls. */
export const createRecordingReporter = () => {
  const captureError = jest.fn<ErrorReporter['captureError']>();
  const reporter: ErrorReporter = { captureError };
  return { reporter, captureError };
};
