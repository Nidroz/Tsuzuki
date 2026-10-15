import type { CatalogProvider } from '@core/catalog/catalog-provider';
import { CatalogContextProvider } from '@core/hooks/CatalogContextProvider';
import { RecentSearchesContextProvider } from '@core/hooks/RecentSearchesContextProvider';
import { I18nProvider, type Language, type MissingKeyHandler } from '@core/i18n/index';
import { createQueryClient } from '@core/query/query-client';
import type { RecentSearchesRepository } from '@core/repositories/recent-searches-repository';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '@ui/index';
import type { ComponentType, ReactElement, ReactNode } from 'react';

import { createStrictFakeCatalogProvider } from '../../src/core/catalog/__fixtures__/fake-catalog-provider';
import { createFakeRecentSearchesRepository } from '../core/fake-recent-searches-repository';

interface WrapperProps {
  readonly children: ReactNode;
}

/** what a test may set; every option has a fresh default per providersFor call */
export interface ProvidersOptions {
  /** the language of the real catalogs, english by default */
  readonly language?: Language;
  /** the catalog provider of the tree; by default a strict fake whose every method rejects */
  readonly catalogProvider?: CatalogProvider;
  /** the recent searches of the tree; by default an empty in-memory repository */
  readonly recentSearchesRepository?: RecentSearchesRepository;
  /** the query cache of the tree; by default a new createQueryClient(), not persisted */
  readonly queryClient?: QueryClient;
}

interface AppProvidersProps extends WrapperProps {
  readonly language: Language;
  readonly catalogProvider: CatalogProvider;
  readonly recentSearchesRepository: RecentSearchesRepository;
  readonly queryClient: QueryClient;
}

export const missingKeyMessage = (language: string, key: string): string =>
  `missing translation key "${key}" (${language}): add it to en.json and fr.json`;

// a key missing from every catalog fails the test through fail-on-console (test/core), which
// points the failure at the t call. not a throw: an aborted render leaves listeners of the discarded
// tree (nativewind's color scheme) that log in the next test. module level: a new handler would
// give the provider a new i18next instance
const failOnMissingKey: MissingKeyHandler = (language, key) => {
  console.error(missingKeyMessage(language, key));
};

/**
 * the providers the composition root (app/_layout.tsx) gives every route and feature, in its
 * order: the query cache (not persisted here), the catalog provider, the recent searches, the real
 * catalogs in `language` with a missing key failing the test, and the light palette for
 * predictable colors
 */
export function AppProviders({
  language,
  catalogProvider,
  recentSearchesRepository,
  queryClient,
  children,
}: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <CatalogContextProvider provider={catalogProvider}>
        <RecentSearchesContextProvider repository={recentSearchesRepository}>
          <I18nProvider language={language} onMissingKey={failOnMissingKey}>
            <ThemeProvider preference="light">{children}</ThemeProvider>
          </I18nProvider>
        </RecentSearchesContextProvider>
      </CatalogContextProvider>
    </QueryClientProvider>
  );
}

/**
 * the wrapper option of render and renderRouterAsync: AppProviders with `options`, english by
 * default. the defaults are created once here, so one wrapper component per call: a rerender keeps
 * the same providers and query client
 */
export const providersFor = ({
  language = 'en',
  catalogProvider = createStrictFakeCatalogProvider(),
  recentSearchesRepository = createFakeRecentSearchesRepository(),
  queryClient = createQueryClient(),
}: ProvidersOptions = {}): ComponentType<WrapperProps> =>
  function Providers({ children }: WrapperProps) {
    return (
      <AppProviders
        language={language}
        catalogProvider={catalogProvider}
        recentSearchesRepository={recentSearchesRepository}
        queryClient={queryClient}
      >
        {children}
      </AppProviders>
    );
  };

/** renders a route or feature component inside AppProviders with `options`, english by default */
export const renderWithProviders = (element: ReactElement, options?: ProvidersOptions) =>
  render(element, { wrapper: providersFor(options) });
