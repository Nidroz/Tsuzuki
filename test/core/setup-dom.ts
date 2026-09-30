import { failOnConsole } from './fail-on-console';
import { pinClockPerTest } from './fixed-clock';
import { stubNetworkGlobals } from './no-network';

// the core-dom project (core .tsx tests in jsdom): the determinism rules of setup.ts without its
// msw/node server, which does not load under jsdom. core hooks reach data through repository and
// catalog provider interfaces, which these tests replace: jsdom's own XMLHttpRequest and
// WebSocket would reach the real network, so every network global throws instead
pinClockPerTest();
failOnConsole();
stubNetworkGlobals();
