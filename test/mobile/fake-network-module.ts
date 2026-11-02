import type * as ExpoNetwork from 'expo-network';
import type { NetworkState } from 'expo-network';

const ONLINE: NetworkState = { isConnected: true, isInternetReachable: true };
const OFFLINE: NetworkState = { isConnected: false, isInternetReachable: false };

/** the device network a test drives: its state, read by each initial read and sent on a change */
export interface FakeNetwork {
  /** sets the device network and tells every listener of the change */
  readonly setOnline: (online: boolean) => void;
  readonly isOnline: () => boolean;
}

/**
 * an expo-network module over one device network a test drives (online at first), replacing the
 * fixed online one of test/mobile/setup.ts: the platform connectivity (src/platform/connectivity.ts)
 * reads its state when the onlineManager subscribes again (a launch after every listener left) and
 * hears each change, as on a device. use it from a jest.mock factory:
 * `jest.mock('expo-network', () => jest.requireActual<typeof FakeNetworkModule>('../mobile/fake-network-module').fakeNetworkModule())`
 * then read `network` with `jest.requireMock<FakeNetworkModule.FakeNetworkModule>('expo-network')`
 */
export const fakeNetworkModule = () => {
  const listeners = new Set<(state: NetworkState) => void>();
  let state = ONLINE;
  const network: FakeNetwork = {
    setOnline: (online) => {
      state = online ? ONLINE : OFFLINE;
      for (const listener of [...listeners]) {
        listener(state);
      }
    },
    isOnline: () => state === ONLINE,
  };
  const module = {
    addNetworkStateListener: (listener: (state: NetworkState) => void) => {
      listeners.add(listener);
      return {
        remove: () => {
          listeners.delete(listener);
        },
      };
    },
    getNetworkStateAsync: () => Promise.resolve(state),
  } satisfies Pick<typeof ExpoNetwork, 'addNetworkStateListener' | 'getNetworkStateAsync'>;
  return { ...module, network };
};

/** the mocked module, as a test reads it with jest.requireMock */
export type FakeNetworkModule = ReturnType<typeof fakeNetworkModule>;
