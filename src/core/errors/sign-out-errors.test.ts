import { describe, expect, it } from '@jest/globals';

import { SIGN_OUT_SYNC_STEPS, SignOutSyncError } from './sign-out-errors';

describe('SignOutSyncError', () => {
  it('lists the steps in the sync order', () => {
    expect(SIGN_OUT_SYNC_STEPS).toStrictEqual(['flush', 'replay']);
  });

  it.each(SIGN_OUT_SYNC_STEPS)('keeps the %s step, and only it', (step) => {
    const error = new SignOutSyncError(step);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SignOutSyncError');
    expect(error.step).toBe(step);
    expect(error.cause).toBeUndefined();
    expect(Object.keys(error).sort()).toStrictEqual(['name', 'step']);
  });

  it('gives each step its own fixed message', () => {
    expect(SIGN_OUT_SYNC_STEPS.map((step) => new SignOutSyncError(step).message)).toStrictEqual([
      'Sign out sync failed: flush',
      'Sign out sync failed: replay',
    ]);
  });
});
