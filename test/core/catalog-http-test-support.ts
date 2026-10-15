import { expect, jest } from '@jest/globals';
import { http } from 'msw';

import { FIXED_NOW } from './fixed-clock';
import { server } from './msw-server';

// helpers shared by the catalog http test suites (src/core/catalog/http). test/ is outside the
// coverage, and jest runs only its *.test.ts files. not a src/core/**/__tests__ folder: src/ never
// imports test/ outside a *.test.ts file, and these helpers need the msw server and the clock

// ms since the pinned clock of the jest setup (fixed-clock.ts)
export const elapsed = (): number => Date.now() - FIXED_NOW;

// the outcome of a request, value or error, with its rejection handled from the start
export const settle = (request: Promise<unknown>): Promise<unknown> =>
  request.catch((error: unknown) => error);

// lets msw finish its bookkeeping, then checks that nothing is left scheduled
export const expectNoPendingTimer = async (): Promise<void> => {
  await jest.advanceTimersByTimeAsync(0);
  expect(jest.getTimerCount()).toBe(0);
};

// a request as the provider sees it
export interface Dispatch {
  readonly at: number;
  readonly signal: AbortSignal;
}

// answers each request to url with answer(request, n), n from 1; returns what each one carried
export const recordRequests = (
  url: string,
  answer: (request: Request, dispatch: number) => Response | Promise<Response>,
): Dispatch[] => {
  const dispatches: Dispatch[] = [];
  server.use(
    http.get(url, ({ request }) => {
      dispatches.push({ at: elapsed(), signal: request.signal });
      return answer(request, dispatches.length);
    }),
  );
  return dispatches;
};

// a response that never comes
export const neverAnswer = (): Promise<Response> => new Promise<Response>(() => undefined);
