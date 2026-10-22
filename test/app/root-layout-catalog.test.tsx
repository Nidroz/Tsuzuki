import type { CatalogProvider } from '@core/catalog/catalog-provider';
import type * as FailureMonitor from '@core/catalog/catalog-failure-monitor';
import type * as JikanProvider from '@core/catalog/jikan/jikan-catalog-provider';
import { TENRAI_INSTANCE } from '@core/catalog/jikan/jikan-instances';
import { useCatalogProvider } from '@core/hooks/use-catalog-provider';
import { describe, expect, it, jest } from '@jest/globals';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';
import { useEffect } from 'react';
import { Text } from 'react-native';

import { renderRouterAsync } from '../mobile/render-router';
import { APP_ROUTES, appRoutesWithDiscover } from './app-routes';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';

// aDR-0013: the composition root (app/_layout.tsx) is the only place that picks the catalog
// provider and its instance. both factories keep their real behaviour and record their calls,
// made once, when the layout module loads; nothing reaches the network (no search is typed)

// no supabase client: the composition root gets a signed-out fake auth repository
jest.mock('@core/repositories/supabase/create-supabase-client', () =>
  jest
    .requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module')
    .fakeSupabaseClientModule(),
);
jest.mock('@core/repositories/supabase/auth-repository', () =>
  jest
    .requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module')
    .fakeSupabaseAuthModule(),
);

jest.mock('@core/catalog/jikan/jikan-catalog-provider', () => {
  const actual = jest.requireActual<typeof JikanProvider>(
    '@core/catalog/jikan/jikan-catalog-provider',
  );
  return { ...actual, createJikanCatalogProvider: jest.fn(actual.createJikanCatalogProvider) };
});

jest.mock('@core/catalog/catalog-failure-monitor', () => {
  const actual = jest.requireActual<typeof FailureMonitor>('@core/catalog/catalog-failure-monitor');
  return { ...actual, monitorCatalogProvider: jest.fn(actual.monitorCatalogProvider) };
});

jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => [{ languageTag: 'en-US' }],
}));

// read from the mock registry: a static import would load the modules before @jest/globals,
// which the hoisted factories above need
const createJikan = jest.mocked(
  jest.requireMock<typeof JikanProvider>('@core/catalog/jikan/jikan-catalog-provider')
    .createJikanCatalogProvider,
);
const monitor = jest.mocked(
  jest.requireMock<typeof FailureMonitor>('@core/catalog/catalog-failure-monitor')
    .monitorCatalogProvider,
);

// tenrai's q maximum, JIKAN_QUERY_MAX_LENGTH
const TENRAI_QUERY_MAX_LENGTH = 300;

// the provider the tree receives, read by a stub Discover route
const seen: { provider: CatalogProvider | null } = { provider: null };

function CatalogProbe() {
  const provider = useCatalogProvider();
  useEffect(() => {
    seen.provider = provider;
  }, [provider]);
  return <Text>{`${provider.namespace}:${provider.instanceId}`}</Text>;
}

describe('root layout catalog wiring (ADR-0013)', () => {
  it('creates one tenrai provider when the build sets no jikan base url', () => {
    // the test env of test/mobile/setup.ts has no jikanBaseUrl
    expect(createJikan).toHaveBeenCalledTimes(1);
    expect(createJikan).toHaveBeenCalledWith(TENRAI_INSTANCE);
  });

  it('gives the tree the tenrai provider wrapped in the failure monitor', async () => {
    await renderRouterAsync(appRoutesWithDiscover(CatalogProbe));

    const created = createJikan.mock.results[0];
    const monitored = monitor.mock.results[0];
    expect(monitor).toHaveBeenCalledTimes(1);
    expect(monitor).toHaveBeenCalledWith(created?.value, { reporter: expect.any(Object) });
    expect(seen.provider).toBe(monitored?.value);
    expect(seen.provider).not.toBe(created?.value);
    expect(seen.provider).toMatchObject({
      namespace: 'mal',
      instanceId: 'tenrai',
      searchQueryMaxLength: TENRAI_QUERY_MAX_LENGTH,
    });
    expect(screen.getByText('mal:tenrai')).toBeOnTheScreen();
  });

  it('caps the search field of the search tab at the tenrai search text limit', async () => {
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/search' });

    expect(screen.getByTestId('search-input')).toHaveProp('maxLength', TENRAI_QUERY_MAX_LENGTH);
  });
});
