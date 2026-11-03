import { jest } from '@jest/globals';
import type { QueryClient } from '@tanstack/react-query';

import type * as QueryClientModule from '@core/query/query-client';

/**
 * the query client module whose factory still builds the real client, recording each one it
 * returned, so a route test can read the cache of the composition root. use it from a jest.mock
 * factory:
 * `jest.mock('@core/query/query-client', () => jest.requireActual<typeof RecordingQueryClient>('../mobile/recording-query-client').recordingQueryClientModule())`
 */
export const recordingQueryClientModule = () => {
  const actual = jest.requireActual<typeof QueryClientModule>('@core/query/query-client');
  return {
    ...actual,
    createQueryClient: jest.fn<typeof actual.createQueryClient>(actual.createQueryClient),
  } satisfies typeof QueryClientModule;
};

/** the mocked module, as a test reads it with jest.requireMock */
export type RecordingQueryClientModule = ReturnType<typeof recordingQueryClientModule>;

/** the client the module returned last: the one of the root layout mounted last */
export const lastQueryClientOf = (module: RecordingQueryClientModule): QueryClient => {
  const result = module.createQueryClient.mock.results.at(-1);
  if (result?.type !== 'return') {
    throw new Error('the composition root created no query client');
  }
  return result.value;
};
