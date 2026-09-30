import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import { takeUnexpectedConsoleMessages } from './fail-on-console';
import { FIXED_NOW } from './fixed-clock';
import { NO_NETWORK_MESSAGE } from './no-network';

const DELAY_MS = 1000;
const ANY_URL = 'https://example.test/any';
const RENDERED_TEXT = 'rendered in jsdom';

describe('core-dom test setup', () => {
  it('runs in a dom, where react renders with the testing library', () => {
    render(<p>{RENDERED_TEXT}</p>);

    expect(screen.getByText(RENDERED_TEXT).tagName).toBe('P');
  });

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

  it('throws on any network access, jsdom included', () => {
    expect(() => fetch(ANY_URL)).toThrow(`fetch was called: ${NO_NETWORK_MESSAGE}`);
    expect(() => new XMLHttpRequest()).toThrow(`XMLHttpRequest was called: ${NO_NETWORK_MESSAGE}`);
    expect(() => new WebSocket(ANY_URL)).toThrow(`WebSocket was called: ${NO_NETWORK_MESSAGE}`);
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
