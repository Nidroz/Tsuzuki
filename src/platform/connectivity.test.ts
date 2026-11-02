import type { ErrorReporter } from '@core/errors/error-reporter';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { NetworkState } from 'expo-network';

import { CONNECTIVITY_REPORT_SOURCE, createConnectivitySubscription } from './connectivity';

// the network state listener the module registered, the initial read the test settles, and the
// removals of the subscription
let mockEmit: ((state: NetworkState) => void) | null = null;
let mockRead: { resolve: (state: NetworkState) => void; reject: (error: unknown) => void } | null =
  null;
const mockRemove = jest.fn<() => void>();

jest.mock('expo-network', () => ({
  addNetworkStateListener: (listener: (state: NetworkState) => void) => {
    mockEmit = listener;
    return { remove: mockRemove };
  },
  getNetworkStateAsync: () =>
    new Promise<NetworkState>((resolve, reject) => {
      mockRead = { resolve, reject };
    }),
}));

const ONLINE: NetworkState = { isConnected: true, isInternetReachable: true };
const OFFLINE: NetworkState = { isConnected: false, isInternetReachable: false };

const emit = (state: NetworkState): void => {
  mockEmit?.(state);
};

const settleRead = async (outcome: { state: NetworkState } | { error: unknown }) => {
  if ('state' in outcome) {
    mockRead?.resolve(outcome.state);
  } else {
    mockRead?.reject(outcome.error);
  }
  await jest.advanceTimersByTimeAsync(0);
};

const subscribe = () => {
  const captureError = jest.fn<ErrorReporter['captureError']>();
  const listener = jest.fn<(online: boolean) => void>();
  const unsubscribe = createConnectivitySubscription({ captureError })(listener);
  return { captureError, listener, unsubscribe };
};

beforeEach(() => {
  mockEmit = null;
  mockRead = null;
  mockRemove.mockClear();
});

describe('createConnectivitySubscription', () => {
  it.each<[string, boolean, NetworkState]>([
    ['connected and reachable', true, ONLINE],
    ['connected, reachability not known yet', true, { isConnected: true }],
    ['connected, internet unreachable', false, { isConnected: true, isInternetReachable: false }],
    ['not connected', false, OFFLINE],
    ['connection not known', false, {}],
  ])('reports the initial state once read: %s is online %s', async (_name, online, state) => {
    const { listener } = subscribe();

    expect(listener).not.toHaveBeenCalled();

    await settleRead({ state });

    expect(listener.mock.calls).toStrictEqual([[online]]);
  });

  it('reports each network state event', async () => {
    const { listener } = subscribe();
    await settleRead({ state: ONLINE });

    emit(OFFLINE);
    emit(ONLINE);

    expect(listener.mock.calls).toStrictEqual([[true], [false], [true]]);
  });

  it('drops an initial state read after an event, which is newer', async () => {
    const { listener } = subscribe();

    emit(OFFLINE);
    await settleRead({ state: ONLINE });

    expect(listener.mock.calls).toStrictEqual([[false]]);
  });

  it('reports a failed initial read and leaves the state to the events', async () => {
    const { captureError, listener } = subscribe();
    const failure = new Error('network state unavailable');

    await settleRead({ error: failure });

    expect(listener).not.toHaveBeenCalled();
    expect(captureError).toHaveBeenCalledWith(failure, { source: CONNECTIVITY_REPORT_SOURCE });

    emit(OFFLINE);

    expect(listener.mock.calls).toStrictEqual([[false]]);
  });

  it('removes its listener when unsubscribed, and drops a read settling afterwards', async () => {
    const { listener, unsubscribe } = subscribe();

    unsubscribe();
    await settleRead({ state: OFFLINE });

    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });
});
