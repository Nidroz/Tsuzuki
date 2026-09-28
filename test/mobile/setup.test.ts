import { describe, expect, it, jest } from '@jest/globals';

import { takeUnexpectedConsoleMessages } from '../core/fail-on-console';
import { FIXED_NOW } from '../core/fixed-clock';

const DELAY_MS = 1000;
const URL = 'https://example.test/any';
const NO_NETWORK = 'component tests have no network';

describe('mobile test setup', () => {
  it('starts every test on the fixed clock with fake timers', () => {
    const callback = jest.fn();
    setTimeout(callback, DELAY_MS);

    expect(Date.now()).toBe(FIXED_NOW);
    expect(callback).not.toHaveBeenCalled();

    jest.advanceTimersByTime(DELAY_MS);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('computes dates in UTC', () => {
    expect(new Date(FIXED_NOW).getTimezoneOffset()).toBe(0);
  });

  it('throws on any network access', () => {
    expect(() => fetch(URL)).toThrow(`fetch was called: ${NO_NETWORK}`);
    expect(() => new XMLHttpRequest()).toThrow(`XMLHttpRequest was called: ${NO_NETWORK}`);
    expect(() => new WebSocket(URL)).toThrow(`WebSocket was called: ${NO_NETWORK}`);
  });

  it('records an unexpected console error or warning to fail the test', () => {
    console.error('boom');
    console.warn('careful');

    expect(takeUnexpectedConsoleMessages()).toStrictEqual([
      'unexpected console.error: boom',
      'unexpected console.warn: careful',
    ]);
  });
});
