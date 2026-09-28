import { renderRouter } from 'expo-router/testing-library';

type RenderRouterResult = ReturnType<typeof renderRouter>;

export type RenderedRouter = Pick<
  RenderRouterResult,
  'getPathname' | 'getPathnameWithParams' | 'getSegments' | 'getSearchParams' | 'getRouterState'
>;

// expo-router 57 types renderRouter as synchronous, but with react native testing library 14 it
// returns the pending (async) render with the router getters attached. awaiting it waits for the
// first render, so `screen` is ready; the getters are copied because returning a thenable from an
// async function would resolve to the bare render result
export const renderRouterAsync = async (
  ...args: Parameters<typeof renderRouter>
): Promise<RenderedRouter> => {
  const pending = renderRouter(...args);
  await (pending as unknown as PromiseLike<unknown>);
  return {
    getPathname: () => pending.getPathname(),
    getPathnameWithParams: () => pending.getPathnameWithParams(),
    getSegments: () => pending.getSegments(),
    getSearchParams: () => pending.getSearchParams(),
    getRouterState: () => pending.getRouterState(),
  };
};
