import { describe, expect, it, jest } from '@jest/globals';

import { createTokenRefreshRefusalSignal } from './token-refresh-refusals';

describe('createTokenRefreshRefusalSignal', () => {
  it('tells each refusal to every listener, in subscription order, with nothing', () => {
    const signal = createTokenRefreshRefusalSignal();
    const calls: unknown[][] = [];
    signal.subscribe((...args: unknown[]) => calls.push(['first', ...args]));
    signal.subscribe((...args: unknown[]) => calls.push(['second', ...args]));

    signal.notify();

    expect(calls).toStrictEqual([['first'], ['second']]);
  });

  it('loses a refusal told before any listener', () => {
    const signal = createTokenRefreshRefusalSignal();
    signal.notify();
    const listener = jest.fn<() => void>();

    signal.subscribe(listener);

    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribes each subscription on its own, the same function twice included', () => {
    const signal = createTokenRefreshRefusalSignal();
    const listener = jest.fn<() => void>();
    const unsubscribeFirst = signal.subscribe(listener);
    signal.subscribe(listener);

    unsubscribeFirst();
    signal.notify();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
