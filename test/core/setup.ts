import { afterAll, afterEach, beforeAll } from '@jest/globals';

import { failOnConsole } from './fail-on-console';
import { pinClockPerTest } from './fixed-clock';
import { server } from './msw-server';

pinClockPerTest();
failOnConsole();

// a request without a handler fails the test instead of reaching the network
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
