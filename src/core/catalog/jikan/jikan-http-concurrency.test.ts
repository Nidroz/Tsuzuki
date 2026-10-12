import { describe, expect, it, jest } from '@jest/globals';
import { delay, http, HttpResponse } from 'msw';

import { FIXED_NOW } from '../../../../test/core/fixed-clock';
import { server } from '../../../../test/core/msw-server';
import { createCatalogHttpClient } from '../http/catalog-http-client';
import { JIKAN_RATE_LIMIT } from './jikan-rate-limit';

// the jikan rate limit through the real http client: concurrent callers, in-flight duplicates,
// provider latency and a 429 mid-run never break the documented limits

const BASE_URL = 'https://catalog.test/anime';
const CALLS = 150;
// documented jikan v4 limit per second
const PER_SECOND_LIMIT = 3;
// the policy's own bound for a minute, below the documented 60 per minute
const PER_MINUTE_BOUND = 50;
const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;
const ARRIVAL_SEED = 2026;
const CHOICE_SEED = 7;
// a call joins a url still in flight this often, when there is one
const DUPLICATE_SHARE = 0.25;
// provider latency, from 40 to 240 ms depending on the id
const MIN_RESPONSE_DELAY_MS = 40;
const RESPONSE_DELAY_STEP_MS = 50;
const RESPONSE_DELAY_STEPS = 5;
// the first request dispatched from then on gets the 429
const RATE_LIMITED_FROM_MS = 90_000;
const PAUSE_MS = 2_000;

interface Dispatch {
  readonly at: number;
  readonly id: number;
}

interface Call {
  readonly id: number;
  readonly result: Promise<unknown>;
}

// a small seeded linear congruential generator: the same run every time
const createLcg = (seed: number) => {
  let state = seed;
  return (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
};

const elapsed = (): number => Date.now() - FIXED_NOW;

const urlOf = (id: number): string => `${BASE_URL}/${String(id)}`;

const payloadOf = (id: number) => ({ data: { mal_id: id } });

// arrival offsets: bursts of simultaneous calls mixed with gaps of up to 2.5 s, faster than the
// 40 per minute the policy sustains, so a queue builds up
const arrivalsOf = (seed: number): number[] => {
  const random = createLcg(seed);
  let at = 0;
  return Array.from({ length: CALLS }, () => {
    at += random() < 0.3 ? 0 : Math.floor(random() * 2_500);
    return at;
  });
};

// the most dispatches in any closed window [t, t + windowMs], as the documented bounds count;
// a fullest window starts on one
const maxInWindow = (times: readonly number[], windowMs: number): number =>
  Math.max(
    ...times.map((start) => times.filter((at) => at >= start && at <= start + windowMs).length),
  );

// the provider: answers each id with its payload after a latency, except one 429 mid-run
const serveProvider = () => {
  const dispatches: Dispatch[] = [];
  const rateLimited: { id: number | null; pauseFrom: number } = { id: null, pauseFrom: 0 };
  server.use(
    http.get<{ id: string }>(`${BASE_URL}/:id`, async ({ params }) => {
      const id = Number(params.id);
      const at = elapsed();
      dispatches.push({ at, id });
      await delay(MIN_RESPONSE_DELAY_MS + (id % RESPONSE_DELAY_STEPS) * RESPONSE_DELAY_STEP_MS);
      if (rateLimited.id === null && at >= RATE_LIMITED_FROM_MS) {
        rateLimited.id = id;
        // the client pauses from the moment it reads this response
        rateLimited.pauseFrom = elapsed();
        return new HttpResponse(null, {
          status: 429,
          headers: { 'Retry-After': String(PAUSE_MS / SECOND_MS) },
        });
      }
      return HttpResponse.json(payloadOf(id));
    }),
  );
  return { dispatches, rateLimited };
};

// schedules every call; at its arrival, a call joins a url still in flight or asks for a new one
const scheduleCalls = (getJson: (url: string) => Promise<unknown>): Call[] => {
  const choose = createLcg(CHOICE_SEED);
  const inFlight = new Set<number>();
  const calls: Call[] = [];
  let nextId = 1;
  for (const arrival of arrivalsOf(ARRIVAL_SEED)) {
    setTimeout(() => {
      const pending = [...inFlight];
      const joined =
        pending.length > 0 && choose() < DUPLICATE_SHARE
          ? pending[Math.floor(choose() * pending.length)]
          : undefined;
      const id = joined ?? nextId++;
      inFlight.add(id);
      // the outcome, error included, with its rejection handled from the start
      const result = getJson(urlOf(id)).catch((error: unknown) => error);
      const leave = (): void => {
        inFlight.delete(id);
      };
      void result.then(leave);
      calls.push({ id, result });
    }, arrival);
  }
  return calls;
};

describe('the jikan rate limit under concurrent calls', () => {
  it('keeps every limit through duplicates, latency and a 429', async () => {
    const { dispatches, rateLimited } = serveProvider();
    const client = createCatalogHttpClient({ rateLimit: JIKAN_RATE_LIMIT, random: () => 0 });

    const calls = scheduleCalls((url) => client.getJson(url));
    await jest.runAllTimersAsync();
    const results = await Promise.all(calls.map(({ result }) => result));

    // every caller gets the payload of its own url, the rate limited one included
    expect(calls).toHaveLength(CALLS);
    expect(results).toEqual(calls.map(({ id }) => payloadOf(id)));

    const times = dispatches.map(({ at }) => at);
    expect(maxInWindow(times, SECOND_MS)).toBeLessThanOrEqual(PER_SECOND_LIMIT);
    expect(maxInWindow(times, MINUTE_MS)).toBeLessThanOrEqual(PER_MINUTE_BOUND);

    // one dispatch per url: duplicates joined the request in flight; the 429 was retried once
    const ids = [...new Set(calls.map(({ id }) => id))];
    expect(ids.length).toBeLessThan(CALLS);
    const dispatchesPerId = ids.map((id) => dispatches.filter((sent) => sent.id === id).length);
    expect(dispatchesPerId).toEqual(ids.map((id) => (id === rateLimited.id ? 2 : 1)));

    // nothing is sent during the pause; a request queued through it goes first when it ends
    expect(rateLimited.id).not.toBeNull();
    const pauseEnd = rateLimited.pauseFrom + PAUSE_MS;
    expect(times.filter((at) => at > rateLimited.pauseFrom && at < pauseEnd)).toEqual([]);
    const firstAfterPause = dispatches.find(({ at }) => at >= pauseEnd);
    expect(firstAfterPause?.at).toBe(pauseEnd);
    expect(firstAfterPause?.id).not.toBe(rateLimited.id);

    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});
