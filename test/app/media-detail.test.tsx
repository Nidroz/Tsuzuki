import type { CatalogProvider, MediaDetail } from '@core/catalog/catalog-provider';
import type * as JikanProvider from '@core/catalog/jikan/jikan-catalog-provider';
import { TENRAI_INSTANCE } from '@core/catalog/jikan/jikan-instances';
import { PROGRESS_WRITE_COALESCE_MS } from '@core/domain/library-progress';
import { CatalogHttpError } from '@core/errors/catalog-errors';
import { GUEST_LIBRARY_STORAGE_KEY } from '@core/repositories/local/library-repository';
import { serializeGuestLibrary } from '@core/repositories/local/library-store';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { STORAGE_INSTANCE_ID } from '@platform/storage';
import { act, userEvent } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { router as appRouter } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import { createMMKV } from 'react-native-mmkv';

import en from '../../src/core/i18n/en.json';
import {
  BERSERK_DETAIL,
  FRIEREN_DETAIL,
} from '../../src/features/media-detail/__fixtures__/media-details';
import { entryOf } from '../core/library-entry-fixtures';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { APP_ROUTES } from './app-routes';
import { headerTitles, visibleBackButtons } from './native-header';

// the composition root gets a fake provider instead of the tenrai one: no http
jest.mock('@core/catalog/jikan/jikan-catalog-provider', () =>
  jest.requireActual<typeof FakeJikanModule>('../mobile/fake-jikan-module').fakeJikanModule(),
);

// an english device: the root layout resolves the language from it
const DEVICE_LOCALES: readonly Pick<Localization.Locale, 'languageTag'>[] = [
  { languageTag: 'en-US' },
];

jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => DEVICE_LOCALES,
}));

// the layout persists the query cache to its storage: the shared instance lets each test clear it,
// so no test restores a detail another one fetched
jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof SharedMmkv>('../mobile/shared-mmkv').sharedMmkvModule(),
);

const appStorage = createMMKV({ id: STORAGE_INSTANCE_ID });

const VALID_TEST_ID = 'media-detail-screen';
const CONTENT_TEST_ID = 'media-detail-content';
const MISSING_TEST_ID = 'media-detail-not-found';
const INVALID_TEST_ID = 'media-detail-invalid';
const NOT_FOUND_TEST_ID = 'not-found-screen';
const DISCOVER_TEST_ID = 'discover-screen';
const LIBRARY_TEST_ID = 'media-detail-library';

// the provider the root layout wraps: the mocked factory always returns the same one
const getDetail = jest.mocked(
  jest
    .requireMock<typeof JikanProvider>('@core/catalog/jikan/jikan-catalog-provider')
    .createJikanCatalogProvider(TENRAI_INSTANCE).getDetail,
);

// a detail for any requested key, so the header and navigation cases show a loaded screen
const answersAnyKey: CatalogProvider['getDetail'] = (key) =>
  Promise.resolve({ ...FRIEREN_DETAIL, key });

const resolvesWith =
  (detail: MediaDetail): CatalogProvider['getDetail'] =>
  () =>
    Promise.resolve(detail);

// a cold deep link: the app starts on the url
const openLink = (url: string) => renderRouterAsync(APP_ROUTES, { initialUrl: url });

const linkTo = ({ key }: MediaDetail) =>
  `/media/${key.namespace}/${key.kind}/${String(key.externalId)}`;

describe('media detail route', () => {
  beforeEach(() => {
    appStorage.clearAll();
    getDetail.mockReset();
    getDetail.mockImplementation(answersAnyKey);
  });

  it.each([
    ['anime', FRIEREN_DETAIL],
    ['manga', BERSERK_DETAIL],
  ])('shows the details of a valid %s link, fetched with its parsed key', async (_kind, detail) => {
    getDetail.mockImplementation(resolvesWith(detail));
    const url = linkTo(detail);
    const router = await openLink(url);

    expect(await screen.findByTestId(CONTENT_TEST_ID)).toBeOnTheScreen();
    expect(router.getPathname()).toBe(url);
    expect(screen.getByTestId(VALID_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: detail.title })).toBeOnTheScreen();
    expect(screen.queryByTestId(INVALID_TEST_ID)).not.toBeOnTheScreen();
    expect(getDetail).toHaveBeenCalledTimes(1);
    expect(getDetail).toHaveBeenCalledWith(
      { namespace: 'mal', kind: detail.key.kind, externalId: detail.key.externalId },
      expect.any(AbortSignal),
    );
  });

  // the root layout gives the route its guest library, over the app storage cleared before each test
  it('reads the library on a valid link and writes it only on a tap', async () => {
    getDetail.mockImplementation(resolvesWith(FRIEREN_DETAIL));
    const user = userEvent.setup();
    await openLink(linkTo(FRIEREN_DETAIL));

    const add = await screen.findByRole('button', { name: en.mediaDetail.library.add });

    expect(screen.getByTestId(LIBRARY_TEST_ID)).toContainElement(add);
    expect(appStorage.getString(GUEST_LIBRARY_STORAGE_KEY)).toBeUndefined();

    await user.press(add);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(appStorage.getString(GUEST_LIBRARY_STORAGE_KEY)).toContain(FRIEREN_DETAIL.title);
    expect(screen.getByTestId(`${LIBRARY_TEST_ID}-status`)).toHaveAccessibleName(
      `${en.mediaDetail.library.status.title}, ${en.library.status.planToWatch}`,
    );
  });

  it('shows the stored entry of a deep link to a title in the library, writing nothing', async () => {
    // its snapshot differs from the catalog detail (another cover): opening never refreshes it
    const stored = serializeGuestLibrary([entryOf({ status: 'completed', progress: 28 })]);
    appStorage.set(GUEST_LIBRARY_STORAGE_KEY, stored);
    getDetail.mockImplementation(resolvesWith(FRIEREN_DETAIL));
    await openLink(linkTo(FRIEREN_DETAIL));

    expect(await screen.findByTestId(`${LIBRARY_TEST_ID}-status`)).toHaveAccessibleName(
      `${en.mediaDetail.library.status.title}, ${en.library.status.completed}`,
    );
    expect(screen.getByTestId(`${LIBRARY_TEST_ID}-progress`)).toHaveAccessibleName(
      `${en.mediaDetail.library.progress.title}, 28 / 28 episodes`,
    );
    expect(
      screen.queryByRole('button', { name: en.mediaDetail.library.add }),
    ).not.toBeOnTheScreen();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(PROGRESS_WRITE_COALESCE_MS * 2);
    });

    expect(appStorage.getString(GUEST_LIBRARY_STORAGE_KEY)).toBe(stored);
  });

  it('shows no library section for an invalid link, and writes nothing', async () => {
    await openLink('/media/mal/anime/abc');

    expect(screen.getByTestId(INVALID_TEST_ID)).toBeOnTheScreen();
    expect(screen.queryByTestId(LIBRARY_TEST_ID)).not.toBeOnTheScreen();
    expect(appStorage.getString(GUEST_LIBRARY_STORAGE_KEY)).toBeUndefined();
  });

  it('leads a link to a missing title to Discover, with nothing left to go back to', async () => {
    getDetail.mockImplementation(() => Promise.reject(new CatalogHttpError(404, null)));
    const user = userEvent.setup();
    const router = await openLink('/media/mal/anime/3');

    expect(await screen.findByTestId(MISSING_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByText(en.mediaDetail.error.notFound.title)).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: en.mediaDetail.error.notFound.action }));

    expect(router.getPathname()).toBe('/');
    expect(screen.getByTestId(DISCOVER_TEST_ID)).toBeOnTheScreen();
    expect(screen.queryByTestId(VALID_TEST_ID)).not.toBeOnTheScreen();
    // dismissed to the tabs below, not pushed: no missing title left to go back to
    expect(appRouter.canGoBack()).toBe(false);
    expect(getDetail).toHaveBeenCalledTimes(1);
  });

  it('titles its stack header in the app language', async () => {
    await openLink('/media/mal/anime/1');

    expect(await screen.findByTestId(CONTENT_TEST_ID)).toBeOnTheScreen();
    expect(headerTitles()).toContain(en.mediaDetail.title);
  });

  it('keeps Discover below a cold deep link, so back leads to it', async () => {
    const router = await openLink('/media/mal/manga/42');
    expect(await screen.findByTestId(CONTENT_TEST_ID)).toBeOnTheScreen();

    expect(appRouter.canGoBack()).toBe(true);
    await act(() => {
      appRouter.back();
    });

    expect(router.getPathname()).toBe('/');
    expect(screen.getByTestId(DISCOVER_TEST_ID)).toBeOnTheScreen();
  });

  it.each([
    ['an unknown namespace', '/media/anilist/anime/1'],
    ['an uppercase namespace', '/media/MAL/anime/1'],
    ['an unknown kind', '/media/mal/movie/1'],
    ['an id that is not a number', '/media/mal/anime/abc'],
    ['an id that is not positive', '/media/mal/anime/0'],
  ])('shows a translated error for %s, fetching nothing', async (_case, url) => {
    await openLink(url);

    expect(screen.getByTestId(INVALID_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByText(en.mediaDetail.invalidLink.title)).toBeOnTheScreen();
    expect(screen.getByText(en.mediaDetail.invalidLink.message)).toBeOnTheScreen();
    expect(screen.queryByTestId(VALID_TEST_ID)).not.toBeOnTheScreen();
    expect(getDetail).not.toHaveBeenCalled();
  });

  it('goes back to Discover from an invalid link', async () => {
    const user = userEvent.setup();
    const router = await openLink('/media/mal/anime/abc');

    await user.press(screen.getByRole('button', { name: en.mediaDetail.invalidLink.action }));

    expect(router.getPathname()).toBe('/');
    expect(screen.getByTestId(DISCOVER_TEST_ID)).toBeOnTheScreen();
    expect(screen.queryByTestId(INVALID_TEST_ID)).not.toBeOnTheScreen();
    // dismissed to the tabs below, not pushed: one Discover, no invalid link left to go back to
    expect(appRouter.canGoBack()).toBe(false);
  });

  it('shows the not found screen for an old link without a namespace', async () => {
    await openLink('/media/anime/1');

    expect(screen.getByTestId(NOT_FOUND_TEST_ID)).toBeOnTheScreen();
    expect(screen.queryByTestId(VALID_TEST_ID)).not.toBeOnTheScreen();
    expect(screen.queryByTestId(INVALID_TEST_ID)).not.toBeOnTheScreen();
    expect(getDetail).not.toHaveBeenCalled();
  });

  it('shows no untranslated back title or back menu over the tabs', async () => {
    await openLink('/media/mal/anime/1');
    expect(await screen.findByTestId(CONTENT_TEST_ID)).toBeOnTheScreen();

    expect(visibleBackButtons()).toStrictEqual([
      { backTitle: undefined, minimal: true, disableBackButtonMenu: true },
    ]);
  });
});
