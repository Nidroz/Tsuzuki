import { describe, expect, it, jest } from '@jest/globals';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createFakeCatalogProvider } from '../catalog/__fixtures__/fake-catalog-provider';
import type { CatalogProvider, Genre } from '../catalog/catalog-provider';
import type { MediaKind } from '../domain/media';
import { CatalogNetworkError } from '../errors/catalog-errors';
import { queryKeys } from '../query/keys';
import { createQueryClient } from '../query/query-client';
import { STALE_TIMES } from '../query/stale-times';
import { MISSING_CATALOG_PROVIDER_MESSAGE } from './catalog-context';
import { CatalogContextProvider } from './CatalogContextProvider';
import { useGenres } from './use-genres';

const ANIME_GENRES: readonly Genre[] = [
  { id: 1, name: 'Action' },
  { id: 12, name: 'Hentai' },
];
const MANGA_GENRES: readonly Genre[] = [{ id: 2, name: 'Adventure' }];

// long enough for any retry with backoff to have happened
const NO_RETRY_WINDOW_MS = 60_000;

type GetGenres = CatalogProvider['getGenres'];

const byKind: GetGenres = (kind) => Promise.resolve(kind === 'anime' ? ANIME_GENRES : MANGA_GENRES);

const wrapperOf = (provider: CatalogProvider, queryClient: QueryClient) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <CatalogContextProvider provider={provider}>{children}</CatalogContextProvider>
      </QueryClientProvider>
    );
  };

const setup = (kind: MediaKind, getGenres: GetGenres = byKind) => {
  const provider = createFakeCatalogProvider();
  provider.getGenres.mockImplementation(getGenres);
  const queryClient: QueryClient = createQueryClient();
  const wrapper = wrapperOf(provider, queryClient);
  const hook = renderHook(({ kind: current }: { kind: MediaKind }) => useGenres(current), {
    initialProps: { kind },
    wrapper,
  });
  return { provider, queryClient, ...hook };
};

describe('useGenres', () => {
  it('fetches the genres of the kind with the query signal, under the genres key', async () => {
    const { provider, queryClient, result } = setup('anime');

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(provider.getGenres).toHaveBeenCalledTimes(1);
    expect(provider.getGenres).toHaveBeenCalledWith('anime', expect.any(AbortSignal));
    // adult genres included: the sheet hides them itself
    expect(result.current.data).toStrictEqual(ANIME_GENRES);
    expect(queryClient.getQueryData(queryKeys.genres('mal', 'anime'))).toStrictEqual(ANIME_GENRES);
  });

  it('keeps the genres fresh for STALE_TIMES.genres', async () => {
    const { queryClient, result } = setup('anime');

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.isStale).toBe(false);
    expect(
      queryClient.getQueryCache().find({ queryKey: queryKeys.genres('mal', 'anime') })?.options,
    ).toMatchObject({ staleTime: STALE_TIMES.genres });
  });

  it('fetches the other kind under its own key when the kind changes', async () => {
    const { provider, result, rerender } = setup('anime');
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    rerender({ kind: 'manga' });

    await waitFor(() => {
      expect(result.current.data).toStrictEqual(MANGA_GENRES);
    });
    expect(provider.getGenres).toHaveBeenLastCalledWith('manga', expect.any(AbortSignal));
  });

  it('surfaces a provider error after a single call, then fetches again on refetch', async () => {
    const error = new CatalogNetworkError();
    const { provider, result } = setup('anime', () => Promise.reject(error));

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(NO_RETRY_WINDOW_MS);
    });

    expect(result.current.error).toBe(error);
    expect(provider.getGenres).toHaveBeenCalledTimes(1);

    provider.getGenres.mockImplementation(byKind);
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.data).toStrictEqual(ANIME_GENRES);
    });
    expect(provider.getGenres).toHaveBeenCalledTimes(2);
  });

  it('fetches nothing while disabled, then fetches once enabled', async () => {
    const provider = createFakeCatalogProvider();
    provider.getGenres.mockImplementation(byKind);
    const queryClient = createQueryClient();
    const wrapper = wrapperOf(provider, queryClient);
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useGenres('anime', { enabled }),
      { initialProps: { enabled: false }, wrapper },
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(NO_RETRY_WINDOW_MS);
    });

    expect(provider.getGenres).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');

    rerender({ enabled: true });

    await waitFor(() => {
      expect(result.current.data).toStrictEqual(ANIME_GENRES);
    });
    expect(provider.getGenres).toHaveBeenCalledTimes(1);
  });

  it('returns the cached genres while disabled', async () => {
    const { provider, queryClient } = setup('anime');
    await waitFor(() => {
      expect(provider.getGenres).toHaveBeenCalledTimes(1);
    });
    const wrapper = wrapperOf(provider, queryClient);

    const { result } = renderHook(() => useGenres('anime', { enabled: false }), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toStrictEqual(ANIME_GENRES);
    });
    expect(provider.getGenres).toHaveBeenCalledTimes(1);
  });

  it('throws outside CatalogContextProvider', () => {
    const queryClient = createQueryClient();
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    expect(() => renderHook(() => useGenres('anime'), { wrapper })).toThrow(
      MISSING_CATALOG_PROVIDER_MESSAGE,
    );
  });
});
