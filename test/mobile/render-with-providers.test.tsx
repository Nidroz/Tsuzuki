import type { CatalogProvider } from '@core/catalog/catalog-provider';
import { useCatalogProvider } from '@core/hooks/use-catalog-provider';
import { useRecentSearches } from '@core/hooks/use-recent-searches';
import { type Language, useTranslation } from '@core/i18n/index';
import { createQueryClient } from '@core/query/query-client';
import { describe, expect, it } from '@jest/globals';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { Spinner, Text } from '@ui/index';

import {
  createStrictFakeCatalogProvider,
  EMPTY_PAGE,
  unexpectedCallMessage,
} from '../../src/core/catalog/__fixtures__/fake-catalog-provider';
import en from '../../src/core/i18n/en.json';
import fr from '../../src/core/i18n/fr.json';
import { createFakeRecentSearchesRepository } from '../core/fake-recent-searches-repository';
import { takeUnexpectedConsoleMessages } from '../core/fail-on-console';
import { missingKeyMessage, providersFor, renderWithProviders } from './render-with-providers';

const MISSING_KEY = 'missing.key';
const SPINNER_LABEL = 'loading';
const SEARCHES_TEST_ID = 'searches';

function Title() {
  const { t } = useTranslation();
  return <Text>{t('tabs.discover')}</Text>;
}

function MissingKeyTitle() {
  const { t } = useTranslation();
  // @ts-expect-error(type-test): the key is in no catalog, which typecheck rejects before run time
  return <Text>{t(MISSING_KEY)}</Text>;
}

// what the tree sees of the providers, written down on each render
interface Seen {
  provider: CatalogProvider | null;
  queryClient: QueryClient | null;
}

const probeOf = (seen: Seen) =>
  function Probe() {
    seen.provider = useCatalogProvider();
    seen.queryClient = useQueryClient();
    const { searches } = useRecentSearches();
    return <Text testID={SEARCHES_TEST_ID}>{searches.join('|')}</Text>;
  };

const nothingSeen = (): Seen => ({ provider: null, queryClient: null });

describe('renderWithProviders', () => {
  it('translates with the real english catalog by default', async () => {
    await renderWithProviders(<Title />);

    expect(screen.getByText(en.tabs.discover)).toBeOnTheScreen();
  });

  it('translates with the catalog of the given language', async () => {
    await renderWithProviders(<Title />, { language: 'fr' });

    expect(screen.getByText(fr.tabs.discover)).toBeOnTheScreen();
  });

  it('gives the theme to components that read the palette', async () => {
    await renderWithProviders(<Spinner accessibilityLabel={SPINNER_LABEL} />);

    expect(screen.getByRole('progressbar', { name: SPINNER_LABEL })).toBeOnTheScreen();
  });

  it.each<Language>(['en', 'fr'])(
    'fails the test of a component asking for a missing key (%s)',
    async (language) => {
      await renderWithProviders(<MissingKeyTitle />, { language });

      // what the check after each test throws on
      expect(takeUnexpectedConsoleMessages()).toStrictEqual([
        `unexpected console.error: ${missingKeyMessage(language, MISSING_KEY)}`,
      ]);
    },
  );

  it('gives a fake catalog provider whose every method rejects, naming it, by default', async () => {
    const seen = nothingSeen();
    const Probe = probeOf(seen);

    await renderWithProviders(<Probe />);

    const provider = seen.provider;
    expect(provider).not.toBeNull();
    await expect(provider?.search({ kind: 'anime', page: 1 })).rejects.toThrow(
      unexpectedCallMessage('search'),
    );
    await expect(provider?.getGenres('manga')).rejects.toThrow(unexpectedCallMessage('getGenres'));
  });

  it('gives the catalog provider, the recent searches and the query client passed', async () => {
    const seen = nothingSeen();
    const Probe = probeOf(seen);
    const catalogProvider = createStrictFakeCatalogProvider({
      getTop: () => Promise.resolve(EMPTY_PAGE),
    });
    const queryClient = createQueryClient();

    await renderWithProviders(<Probe />, {
      catalogProvider,
      queryClient,
      recentSearchesRepository: createFakeRecentSearchesRepository(['frieren', 'mushishi']),
    });

    expect(seen.provider).toBe(catalogProvider);
    expect(seen.queryClient).toBe(queryClient);
    await expect(catalogProvider.getTop('anime', 1)).resolves.toBe(EMPTY_PAGE);
    expect(screen.getByTestId(SEARCHES_TEST_ID)).toHaveTextContent('frieren|mushishi');
  });

  it('starts with no recent search by default', async () => {
    const Probe = probeOf(nothingSeen());

    await renderWithProviders(<Probe />);

    expect(screen.getByTestId(SEARCHES_TEST_ID)).toHaveTextContent('');
  });

  it('gives each render a new query client and catalog provider', async () => {
    const first = nothingSeen();
    const second = nothingSeen();
    const FirstProbe = probeOf(first);
    const SecondProbe = probeOf(second);

    await renderWithProviders(<FirstProbe />);
    await renderWithProviders(<SecondProbe />);

    expect(second.queryClient).not.toBeNull();
    expect(second.queryClient).not.toBe(first.queryClient);
    expect(second.provider).not.toBe(first.provider);
  });
});

describe('providersFor', () => {
  it('keeps the same query client and catalog provider across a rerender', async () => {
    const seen = nothingSeen();
    const Probe = probeOf(seen);
    const { rerender } = await render(<Probe />, { wrapper: providersFor() });
    const { provider, queryClient } = seen;

    await rerender(<Probe />);

    expect(seen.provider).toBe(provider);
    expect(seen.queryClient).toBe(queryClient);
  });
});
