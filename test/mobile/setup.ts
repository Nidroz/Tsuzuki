import { jest } from '@jest/globals';

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
