import { describe, expect, it } from '@jest/globals';

import {
  DEVICE_PURGE_MARKER_OPERATIONS,
  DEVICE_PURGE_MARKER_PROBLEMS,
  DEVICE_PURGE_STEPS,
  DevicePurgeError,
  DevicePurgeMarkerError,
  DevicePurgeMarkerOperationError,
} from './device-purge-errors';

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

describe('DevicePurgeMarkerError', () => {
  it('lists the problems of a damaged marker document', () => {
    expect(DEVICE_PURGE_MARKER_PROBLEMS).toStrictEqual([
      'invalid-json',
      'invalid-envelope',
      'invalid-markers',
      'duplicate-users',
    ]);
  });

  it.each(DEVICE_PURGE_MARKER_PROBLEMS)('keeps the %s problem, and only it', (problem) => {
    const error = new DevicePurgeMarkerError(problem);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DevicePurgeMarkerError');
    expect(error.problem).toBe(problem);
    expect(error.message).toBe(`Device purge marker is damaged: ${problem}`);
    expect(error.cause).toBeUndefined();
    expect(Object.keys(error).sort()).toStrictEqual(['name', 'problem']);
  });
});

describe('DevicePurgeMarkerOperationError', () => {
  it.each(DEVICE_PURGE_MARKER_OPERATIONS)('holds the %s operation only', (operation) => {
    const error = new DevicePurgeMarkerOperationError(operation);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DevicePurgeMarkerOperationError');
    expect(error.operation).toBe(operation);
    expect(error.message).toBe(`Device purge marker failed: ${operation}`);
    expect(error.cause).toBeUndefined();
  });
});
