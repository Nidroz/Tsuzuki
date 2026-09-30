import { failOnConsole } from '../core/fail-on-console';
import { pinClockPerTest } from '../core/fixed-clock';
import { stubNetworkGlobals } from '../core/no-network';

pinClockPerTest();
failOnConsole();
// runs after the jest-expo preset setup, which may rely on the real globals
stubNetworkGlobals();
