// msw handlers on the real urls of a jikan v4 instance, tenrai by default, for the provider tests:
// each handler records the requests it answered, with their dispatch time on the fake clock. tests
// install them on the msw server of test/core
import { http, HttpResponse, type HttpHandler } from 'msw';

type JsonObject = Record<string, unknown>;

/** the root of every tenrai request, spelled out: the default provider must reach this exact url. */
export const TENRAI_BASE = 'https://api.tenrai.org/v1';

/** a request as jikan received it. */
export interface JikanRequest {
  readonly url: string;
  // ms since the handler was created, on the fake clock
  readonly at: number;
  readonly signal: AbortSignal;
}

/** the answer to the n-th request of a handler, n from 1. */
export type JikanAnswer = (dispatch: number) => Response | Promise<Response>;

/**
 * a handler of every GET of `path` under `base` (default `TENRAI_BASE`), whatever its query, and
 * its requests.
 */
export const jikanHandler = (
  path: string,
  answer: JikanAnswer,
  base: string = TENRAI_BASE,
): { readonly handler: HttpHandler; readonly requests: readonly JikanRequest[] } => {
  const requests: JikanRequest[] = [];
  const createdAt = Date.now();
  const handler = http.get(`${base}${path}`, ({ request }) => {
    requests.push({ url: request.url, at: Date.now() - createdAt, signal: request.signal });
    return answer(requests.length);
  });
  return { handler, requests };
};

/** answers `body` as json. */
export const jsonAnswer = (body: JsonObject) => (): Response => HttpResponse.json(body);

/** a jikan error response, in the shape of its openapi error schema. */
export const jikanError = (status: number, message = 'Jikan error'): Response =>
  HttpResponse.json({ status, type: 'HttpException', message, error: null }, { status });

/** `text` served as json: reading the body fails. */
export const notJsonAnswer = (text: string) => (): Response =>
  new HttpResponse(text, { headers: { 'Content-Type': 'application/json' } });

/** an answer that never comes, without a timer of its own. */
export const neverAnswer = (): Promise<Response> => new Promise<Response>(() => undefined);

/** answers the first `count` requests with `first`, every later one with `then`. */
export const firstThen =
  (count: number, first: JikanAnswer, then: JikanAnswer): JikanAnswer =>
  (dispatch) =>
    dispatch <= count ? first(dispatch) : then(dispatch);
