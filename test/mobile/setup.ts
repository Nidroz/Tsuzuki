import { jest } from '@jest/globals';
import type * as ExpoConstants from 'expo-constants';

import { failOnConsole } from '../core/fail-on-console';
import { pinClockPerTest } from '../core/fixed-clock';
import { stubNetworkGlobals } from '../core/no-network';

pinClockPerTest();
failOnConsole();
// runs after the jest-expo preset setup, which may rely on the real globals
stubNetworkGlobals();

// react-native-mmkv returns its own in-memory instance under jest (JEST_WORKER_ID is set), but
// imports nitro modules first, whose native module jest lacks: an empty stub lets it load
jest.mock('react-native-nitro-modules', () => ({ NitroModules: {} }));

// the device network, online and never changing: the root layout binds the onlineManager to it as
// it loads (src/platform/connectivity.ts), and the jest-expo native stub would read as offline. a
// test that drives the network mocks expo-network itself
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: () => undefined }),
  getNetworkStateAsync: () => Promise.resolve({ isConnected: true, isInternetReachable: true }),
}));

// the app env that app.config.ts validates into extra.env (ADR-0012), with test values: the root
// layout reads it as it loads and fails closed without it. a test that needs another env mocks
// expo-constants itself
jest.mock('expo-constants', () => {
  const actual = jest.requireActual<typeof ExpoConstants>('expo-constants');
  const constants = actual.default;
  const env = {
    variant: 'development',
    supabaseUrl: 'https://test-project.supabase.co',
    supabaseAnonKey: 'sb_publishable_test-key',
  };
  return {
    ...actual,
    __esModule: true,
    default: Object.create(constants, {
      expoConfig: {
        get: () => ({
          ...constants.expoConfig,
          extra: { ...constants.expoConfig?.extra, env },
        }),
      },
    }) as typeof constants,
  };
});
