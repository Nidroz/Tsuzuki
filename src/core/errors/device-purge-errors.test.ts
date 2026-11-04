import { describe, expect, it } from '@jest/globals';

import { DEVICE_PURGE_STEPS, DevicePurgeError } from './device-purge-errors';

describe('DevicePurgeError', () => {
  it('lists the steps in the purge order', () => {
    expect(DEVICE_PURGE_STEPS).toStrictEqual([
      'account-library',
      'guest-library',
      'recent-searches',
      'query-cache',
      'persisted-cache',
    ]);
  });

  it.each(DEVICE_PURGE_STEPS)('keeps the %s step, and only it', (step) => {
    const error = new DevicePurgeError(step);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DevicePurgeError');
    expect(error.step).toBe(step);
    expect(error.cause).toBeUndefined();
    expect(Object.keys(error).sort()).toStrictEqual(['name', 'step']);
  });

  it('gives each step its own fixed message', () => {
    const messages = DEVICE_PURGE_STEPS.map((step) => new DevicePurgeError(step).message);

    expect(new Set(messages).size).toBe(DEVICE_PURGE_STEPS.length);
    expect(new DevicePurgeError('query-cache').message).toBe('Device purge failed: query cache');
  });
});
