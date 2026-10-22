import { createStrictFakeCatalogProvider } from '@core/catalog/__fixtures__/fake-catalog-provider';
import type { CatalogProvider, MediaDetail } from '@core/catalog/catalog-provider';
import {
  CatalogHttpError,
  CatalogNetworkError,
  CatalogResponseError,
  CatalogTimeoutError,
} from '@core/errors/catalog-errors';
import { LibraryContextProvider } from '@core/hooks/LibraryContextProvider';
import { queryKeys } from '@core/query/keys';
import { createQueryClient } from '@core/query/query-client';
import { STALE_TIMES } from '@core/query/stale-times';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { QueryClient } from '@tanstack/react-query';
import { screen, userEvent, waitFor } from '@testing-library/react-native';

import { createFakeLibraryRepository } from '../../../test/core/fake-library-repository';
import { createFakeRecentSearchesRepository } from '../../../test/core/fake-recent-searches-repository';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { ADULT_DETAIL, FRIEREN_DETAIL } from './__fixtures__/media-details';
import { MediaDetailView } from './MediaDetailView';

// the whole router: the view may only dismiss to Discover, never push, replace or go back
const mockRouter = {
  dismissTo: jest.fn<(href: string) => void>(),
  push: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  back: jest.fn(),
};

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => mockRouter,
}));

const SCREEN_TEST_ID = 'media-detail-screen';
const CONTENT_TEST_ID = 'media-detail-content';
const ERROR_TEST_ID = 'media-detail-error';
const NOT_FOUND_TEST_ID = 'media-detail-not-found';
const HIDDEN_TEST_ID = 'media-detail-hidden';
const LOADING_TEST_ID = 'media-detail-loading';
const LIBRARY_TEST_ID = 'media-detail-library';
const ADD_TO_LIBRARY = 'Add to library';

const LOADING = 'Loading details';
const NOT_FOUND_TITLE = 'Title not found';
const NOT_FOUND_MESSAGE = 'This anime or manga does not exist in the catalog.';
const NOT_FOUND_ACTION = 'Go to Discover';
const OFFLINE_TITLE = 'You are offline';
const OFFLINE_MESSAGE = 'Check your connection, then try again.';
const GENERIC_TITLE = 'Details could not be loaded';
const GENERIC_MESSAGE = 'Something went wrong. Try again in a moment.';
const RETRY = 'Try again';
const HIDDEN_TITLE = 'Title hidden';
const HIDDEN_MESSAGE =
  'This title is adult content. Turn on Show adult content in Settings to see it.';

type GetDetail = CatalogProvider['getDetail'];

const resolvesWith =
  (detail: MediaDetail): GetDetail =>
  () =>
    Promise.resolve(detail);
const rejectsWith =
  (error: Error): GetDetail =>
  () =>
    Promise.reject(error);

// a detail request that settles with the detail the test answers, once it started
const detailAnsweredByTest = () => {
  let settle: (detail: MediaDetail) => void = () => undefined;
  const getDetail: GetDetail = () =>
    new Promise<MediaDetail>((resolve) => {
      settle = resolve;
    });
  const answer = (detail: MediaDetail): void => {
    settle(detail);
  };
  return { getDetail, answer };
};

const renderView = async (
  getDetail: GetDetail,
  media: MediaDetail = FRIEREN_DETAIL,
  queryClient: QueryClient = createQueryClient(),
) => {
  const provider = createStrictFakeCatalogProvider({ getDetail });
  const repository = createFakeRecentSearchesRepository();
  const library = createFakeLibraryRepository();
  await renderWithProviders(
    <LibraryContextProvider repository={library}>
      <MediaDetailView mediaKey={media.key} />
    </LibraryContextProvider>,
    { catalogProvider: provider, recentSearchesRepository: repository, queryClient },
  );
  return { provider, repository, library, queryClient };
};

describe('MediaDetailView', () => {
  beforeEach(() => {
    for (const method of Object.values(mockRouter)) {
      method.mockClear();
    }
  });

  it('shows a labelled spinner while loading, then the details', async () => {
    const { getDetail, answer } = detailAnsweredByTest();
    const { provider } = await renderView(getDetail);

    expect(screen.getByTestId(SCREEN_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByLabelText(LOADING)).toHaveProp('testID', LOADING_TEST_ID);
    expect(screen.queryByTestId(CONTENT_TEST_ID)).not.toBeOnTheScreen();
    expect(screen.queryByTestId(LIBRARY_TEST_ID)).not.toBeOnTheScreen();

    answer(FRIEREN_DETAIL);

    expect(await screen.findByTestId(CONTENT_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByTestId(SCREEN_TEST_ID)).toBeOnTheScreen();
    expect(screen.queryByTestId(LOADING_TEST_ID)).not.toBeOnTheScreen();
    expect(screen.getByRole('header', { name: FRIEREN_DETAIL.title })).toBeOnTheScreen();
    expect(provider.getDetail).toHaveBeenCalledTimes(1);
    expect(provider.getDetail).toHaveBeenCalledWith(FRIEREN_DETAIL.key, expect.any(AbortSignal));
  });

  it('shows the not found state for a missing title, whose action only dismisses to Discover', async () => {
    const user = userEvent.setup();
    const { provider } = await renderView(rejectsWith(new CatalogHttpError(404, null)));

    expect(await screen.findByTestId(NOT_FOUND_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByTestId(SCREEN_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByText(NOT_FOUND_TITLE)).toBeOnTheScreen();
    expect(screen.getByText(NOT_FOUND_MESSAGE)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: RETRY })).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: NOT_FOUND_ACTION }));

    expect(mockRouter.dismissTo).toHaveBeenCalledTimes(1);
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/');
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
    expect(mockRouter.back).not.toHaveBeenCalled();
    // leaving fetches nothing
    expect(provider.getDetail).toHaveBeenCalledTimes(1);
  });

  it('shows the offline state on a network error, and the details after a successful retry', async () => {
    const user = userEvent.setup();
    const { provider } = await renderView(rejectsWith(new CatalogNetworkError()));

    expect(await screen.findByTestId(ERROR_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByText(OFFLINE_TITLE)).toBeOnTheScreen();
    expect(screen.getByText(OFFLINE_MESSAGE)).toBeOnTheScreen();
    expect(screen.getByTestId(SCREEN_TEST_ID)).toBeOnTheScreen();

    provider.getDetail.mockImplementation(resolvesWith(FRIEREN_DETAIL));
    await user.press(screen.getByRole('button', { name: RETRY }));

    expect(await screen.findByTestId(CONTENT_TEST_ID)).toBeOnTheScreen();
    expect(screen.queryByTestId(ERROR_TEST_ID)).not.toBeOnTheScreen();
    expect(provider.getDetail).toHaveBeenCalledTimes(2);
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
  });

  it('replaces the error with the spinner while the retry runs, and shows it again on a failure', async () => {
    const user = userEvent.setup();
    const { provider } = await renderView(rejectsWith(new CatalogNetworkError()));
    expect(await screen.findByTestId(ERROR_TEST_ID)).toBeOnTheScreen();
    let failRetry: () => void = () => undefined;
    provider.getDetail.mockImplementation(
      () =>
        new Promise<MediaDetail>((_resolve, reject) => {
          failRetry = () => {
            reject(new CatalogNetworkError());
          };
        }),
    );

    await user.press(screen.getByRole('button', { name: RETRY }));

    expect(await screen.findByTestId(LOADING_TEST_ID)).toBeOnTheScreen();
    expect(screen.queryByTestId(ERROR_TEST_ID)).not.toBeOnTheScreen();
    expect(screen.getByTestId(SCREEN_TEST_ID)).toBeOnTheScreen();

    failRetry();

    expect(await screen.findByTestId(ERROR_TEST_ID)).toBeOnTheScreen();
    expect(screen.queryByTestId(LOADING_TEST_ID)).not.toBeOnTheScreen();
    expect(provider.getDetail).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a malformed response', new CatalogResponseError()],
    ['a timeout', new CatalogTimeoutError(10_000)],
    ['a server error', new CatalogHttpError(500, null)],
  ])('shows the generic error state with a retry on %s', async (_case, error) => {
    const { library } = await renderView(rejectsWith(error));

    expect(await screen.findByTestId(ERROR_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByText(GENERIC_TITLE)).toBeOnTheScreen();
    expect(screen.getByText(GENERIC_MESSAGE)).toBeOnTheScreen();
    expect(screen.queryByText(OFFLINE_TITLE)).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: RETRY })).toBeOnTheScreen();
    expect(screen.queryByTestId(LIBRARY_TEST_ID)).not.toBeOnTheScreen();
    expect(library.get).not.toHaveBeenCalled();
  });

  it('shows the library section of a visible title right under its titles, before its facts', async () => {
    await renderView(resolvesWith(FRIEREN_DETAIL));

    expect(await screen.findByRole('button', { name: ADD_TO_LIBRARY })).toBeOnTheScreen();

    const content = screen.getByTestId(CONTENT_TEST_ID);
    const order = content.children
      .filter((child) => typeof child !== 'string')
      .map((child) => child.props.testID as unknown);

    expect(order.indexOf(LIBRARY_TEST_ID)).toBe(1);
    expect(screen.getByTestId(LIBRARY_TEST_ID)).toContainElement(
      screen.getByRole('button', { name: ADD_TO_LIBRARY }),
    );
  });

  it('hides an adult title with the default setting, showing nothing of it (BR-06)', async () => {
    const { library } = await renderView(resolvesWith(ADULT_DETAIL), ADULT_DETAIL);

    expect(await screen.findByTestId(HIDDEN_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByTestId(SCREEN_TEST_ID)).toBeOnTheScreen();
    expect(screen.getByText(HIDDEN_TITLE)).toBeOnTheScreen();
    expect(screen.getByText(HIDDEN_MESSAGE)).toBeOnTheScreen();
    expect(screen.queryByTestId(CONTENT_TEST_ID)).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('media-detail-cover', { includeHiddenElements: true }),
    ).not.toBeOnTheScreen();
    // the title, english title and synopsis of the fixture all start with it
    expect(
      screen.queryByText(ADULT_DETAIL.title, { exact: false, includeHiddenElements: true }),
    ).not.toBeOnTheScreen();
    expect(screen.queryByText('Hentai', { includeHiddenElements: true })).not.toBeOnTheScreen();
    // no library section, so not even a read of the library for a hidden title
    expect(screen.queryByTestId(LIBRARY_TEST_ID)).not.toBeOnTheScreen();
    expect(library.get).not.toHaveBeenCalled();
  });

  it('keeps showing cached details when their refetch fails', async () => {
    const queryClient = createQueryClient();
    // cached a day and a millisecond ago: stale, so the mount refetches
    queryClient.setQueryData(queryKeys.media(FRIEREN_DETAIL.key), FRIEREN_DETAIL, {
      updatedAt: Date.now() - STALE_TIMES.mediaDetail - 1,
    });
    const { provider } = await renderView(
      rejectsWith(new CatalogNetworkError()),
      FRIEREN_DETAIL,
      queryClient,
    );

    expect(screen.getByTestId(CONTENT_TEST_ID)).toBeOnTheScreen();

    await waitFor(() => {
      expect(queryClient.getQueryState(queryKeys.media(FRIEREN_DETAIL.key))?.status).toBe('error');
    });

    expect(provider.getDetail).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(CONTENT_TEST_ID)).toBeOnTheScreen();
    expect(screen.queryByTestId(ERROR_TEST_ID)).not.toBeOnTheScreen();
    expect(screen.queryByTestId(LOADING_TEST_ID)).not.toBeOnTheScreen();
  });

  it('only reads: no repository write, no mutation, no other provider call', async () => {
    const { provider, repository, library, queryClient } = await renderView(
      resolvesWith(FRIEREN_DETAIL),
    );

    await screen.findByRole('button', { name: ADD_TO_LIBRARY });

    // the library is read, written only on a tap
    expect(library.get).toHaveBeenCalledTimes(1);
    expect(library.save).not.toHaveBeenCalled();
    expect(library.remove).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.clear).not.toHaveBeenCalled();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(provider.search).not.toHaveBeenCalled();
    expect(provider.getTop).not.toHaveBeenCalled();
    expect(provider.getCurrentSeason).not.toHaveBeenCalled();
    expect(provider.getGenres).not.toHaveBeenCalled();
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
  });
});
