import { describe, expect, it, jest } from '@jest/globals';
import { http, HttpResponse } from 'msw';

import { takeUnexpectedConsoleMessages } from './fail-on-console';
import { FIXED_NOW } from './fixed-clock';
import { server } from './msw-server';

const DELAY_MS = 1000;
const HANDLED_URL = 'https://example.test/handled';
const UNHANDLED_URL = 'https://example.test/unhandled';
const PAYLOAD = { id: 1, title: 'Frieren' };

describe('test determinism', () => {
  it('starts every test on the fixed clock', () => {
    expect(Date.now()).toBe(FIXED_NOW);
    expect(new Date().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('runs timers only when the test advances them', () => {
    const callback = jest.fn();
    setTimeout(callback, DELAY_MS);

    jest.advanceTimersByTime(DELAY_MS - 1);

    expect(callback).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(Date.now()).toBe(FIXED_NOW + DELAY_MS);
  });

  it('computes dates in UTC', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
    expect(new Date(FIXED_NOW).getTimezoneOffset()).toBe(0);
  });

  it('fails a request that has no handler', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(fetch(UNHANDLED_URL)).rejects.toThrow('Cannot bypass a request');
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('without a matching request handler'),
    );
  });

  it('answers a request from its handler', async () => {
    server.use(http.get(HANDLED_URL, () => HttpResponse.json(PAYLOAD)));

    const response = await fetch(HANDLED_URL);

    expect(response.status).toBe(200);
    // the parsed body comes from node's realm, so its prototype differs from the test's Object
    await expect(response.json()).resolves.toEqual(PAYLOAD);
  });

  it('records an unexpected console error or warning to fail the test', () => {
    console.error('boom', { code: 1 });
    console.warn('careful');

    expect(takeUnexpectedConsoleMessages()).toStrictEqual([
      'unexpected console.error: boom {"code":1}',
      'unexpected console.warn: careful',
    ]);
  });
});
