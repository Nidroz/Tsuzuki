const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket'] as const;

export const NO_NETWORK_MESSAGE =
  'component tests have no network, mock the hook or repository instead';

// component and core hook tests reach data through mocked hooks and repositories: any network
// global throws. used by the setups that run without the msw server (mobile and core-dom)
export const stubNetworkGlobals = (): void => {
  for (const name of NETWORK_GLOBALS) {
    // a plain function throws both when called (fetch) and when constructed (new WebSocket())
    const stub = function networkStub(): never {
      throw new Error(`${name} was called: ${NO_NETWORK_MESSAGE}`);
    };
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: stub });
  }
};
