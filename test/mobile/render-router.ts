import { renderRouter } from 'expo-router/testing-library';

type RenderRouterResult = ReturnType<typeof renderRouter>;

export type RenderedRouter = Pick<
  RenderRouterResult,
  'getPathname' | 'getPathnameWithParams' | 'getSegments' | 'getSearchParams' | 'getRouterState'
>;

export const NOT_THENABLE_MESSAGE =
  'expo-router renderRouter no longer returns a promise: update renderRouterAsync';

/** throws unless the value has a then method, i.e. awaiting it waits for something */
export const assertThenable: (value: unknown) => asserts value is PromiseLike<unknown> = (
  value,
) => {
  const then =
    (typeof value === 'object' && value !== null) || typeof value === 'function'
      ? (value as { then?: unknown }).then
      : undefined;
  if (typeof then !== 'function') {
    throw new TypeError(NOT_THENABLE_MESSAGE);
  }
};

// expo-router 57 types renderRouter as synchronous, but with react native testing library 14 it
// returns the pending (async) render with the router getters attached. awaiting it waits for the
// first render, so `screen` is ready; the getters are copied because returning a thenable from an
// async function would resolve to the bare render result
export const renderRouterAsync = async (
  ...args: Parameters<typeof renderRouter>
): Promise<RenderedRouter> => {
  const pending = renderRouter(...args);
  // without this check a synchronous result would be awaited as a plain value, silently
  assertThenable(pending);
  await pending;
  return {
    getPathname: () => pending.getPathname(),
    getPathnameWithParams: () => pending.getPathnameWithParams(),
    getSegments: () => pending.getSegments(),
    getSearchParams: () => pending.getSearchParams(),
    getRouterState: () => pending.getRouterState(),
  };
};
