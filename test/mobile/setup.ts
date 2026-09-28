import { failOnConsole } from '../core/fail-on-console';
import { pinClockPerTest } from '../core/fixed-clock';

const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket'] as const;

// runs after the jest-expo preset setup, which may rely on the real globals
const stubNetworkGlobals = (): void => {
  for (const name of NETWORK_GLOBALS) {
    // a plain function throws both when called (fetch) and when constructed (new WebSocket())
    const stub = function networkStub(): never {
      throw new Error(
        `${name} was called: component tests have no network, mock the hook or repository instead`,
      );
    };
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: stub });
  }
};

pinClockPerTest();
failOnConsole();
stubNetworkGlobals();
