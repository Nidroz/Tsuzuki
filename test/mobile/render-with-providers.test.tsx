import type { CatalogProvider } from '@core/catalog/catalog-provider';
import { useAuthContext } from '@core/hooks/use-auth-context';
import { useCatalogProvider } from '@core/hooks/use-catalog-provider';
import { useRecentSearches } from '@core/hooks/use-recent-searches';
import { type Language, useTranslation } from '@core/i18n/index';
import { usePreferences } from '@core/preferences/index';
import { createQueryClient } from '@core/query/query-client';
import type { AuthRepository, CaptchaTokenProvider } from '@core/repositories/auth-repository';
import { describe, expect, it } from '@jest/globals';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { Spinner, Text } from '@ui/index';
import { useEffect } from 'react';

import {
  createStrictFakeCatalogProvider,
  EMPTY_PAGE,
  unexpectedCallMessage,
} from '../../src/core/catalog/__fixtures__/fake-catalog-provider';
import en from '../../src/core/i18n/en.json';
import fr from '../../src/core/i18n/fr.json';
import {
  createSessionAuthRepository,
  unexpectedAuthCallMessage,
} from '../core/fake-auth-repository';
import { createFakeRecentSearchesRepository } from '../core/fake-recent-searches-repository';
import { takeUnexpectedConsoleMessages } from '../core/fail-on-console';
import {
  missingKeyMessage,
  providersFor,
  renderWithProviders,
  TestPreferences,
} from './render-with-providers';

const MISSING_KEY = 'missing.key';
const SPINNER_LABEL = 'loading';
const SEARCHES_TEST_ID = 'searches';
const AUTH_STATUS_TEST_ID = 'auth-status';
const USER_ID = '7d4c0f52-7b8e-4a43-9f8a-2f1b3c4d5e6f';

// what the auth probe last read from the auth context
const authSeen: {
  repository: AuthRepository | null;
  captcha: CaptchaTokenProvider | null;
} = { repository: null, captcha: null };

function AuthProbe() {
  const { repository, captcha, state } = useAuthContext();
  useEffect(() => {
    authSeen.repository = repository;
    authSeen.captcha = captcha;
  }, [repository, captcha]);
  return <Text testID={AUTH_STATUS_TEST_ID}>{state.status}</Text>;
}

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

const SHOW_ADULT_TEST_ID = 'show-adult';

function ShowAdultProbe() {
  const { showAdult } = usePreferences();
  return <Text testID={SHOW_ADULT_TEST_ID}>{String(showAdult)}</Text>;
}

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
    await expect(catalogProvider.getTop({ kind: 'anime', page: 1 })).resolves.toBe(EMPTY_PAGE);
    expect(screen.getByTestId(SEARCHES_TEST_ID)).toHaveTextContent('frieren|mushishi');
  });

  it('starts with no recent search by default', async () => {
    const Probe = probeOf(nothingSeen());

    await renderWithProviders(<Probe />);

    expect(screen.getByTestId(SEARCHES_TEST_ID)).toHaveTextContent('');
  });

  it.each<[string, { showAdult?: boolean }, string]>([
    ['off by default', {}, 'false'],
    ['as passed', { showAdult: true }, 'true'],
  ])('gives fixed preferences, adult content %s (BR-06)', async (_case, options, shown) => {
    await renderWithProviders(<ShowAdultProbe />, options);

    expect(screen.getByTestId(SHOW_ADULT_TEST_ID)).toHaveTextContent(shown);
  });

  it('lets a nested TestPreferences override the adult content setting', async () => {
    const { rerender } = await renderWithProviders(
      <TestPreferences showAdult={false}>
        <ShowAdultProbe />
      </TestPreferences>,
      { showAdult: true },
    );

    expect(screen.getByTestId(SHOW_ADULT_TEST_ID)).toHaveTextContent('false');

    await rerender(
      <TestPreferences showAdult>
        <ShowAdultProbe />
      </TestPreferences>,
    );

    expect(screen.getByTestId(SHOW_ADULT_TEST_ID)).toHaveTextContent('true');
  });

  it('gives a signed-out auth repository whose other calls reject, naming them, by default', async () => {
    await renderWithProviders(<AuthProbe />);

    expect(screen.getByTestId(AUTH_STATUS_TEST_ID)).toHaveTextContent('signed-out');
    await expect(authSeen.repository?.signOut()).rejects.toThrow(
      unexpectedAuthCallMessage('signOut'),
    );
  });

  it('gives the auth repository passed, without captcha', async () => {
    const authRepository = createSessionAuthRepository({ userId: USER_ID });

    await renderWithProviders(<AuthProbe />, { authRepository });

    expect(authSeen.repository).toBe(authRepository);
    expect(screen.getByTestId(AUTH_STATUS_TEST_ID)).toHaveTextContent('signed-in');
    await expect(authSeen.captcha?.getToken('sign-in')).resolves.toBeNull();
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
