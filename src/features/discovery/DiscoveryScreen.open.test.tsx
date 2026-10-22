import type { CatalogProvider, MediaSummary, Page } from '@core/catalog/catalog-provider';
import { CatalogHttpError, CatalogNetworkError } from '@core/errors/catalog-errors';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';
import type { Href } from 'expo-router';

import { adultItem, FRIEREN, pageOf } from '../search/__fixtures__/search-results';
import {
  advance,
  foregroundTops,
  renderDiscoveryScreen,
} from '../../../test/mobile/render-discovery-screen';
import { rowOf } from './__fixtures__/discovery-pages';

// fR-05, BR-06: opening a row, the adult titles and the errors of the discovery screen

const mockPush = jest.fn<(href: Href) => void>();

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ push: mockPush }),
}));

const HTTP_SERVICE_UNAVAILABLE = 503;
const FRIEREN_ROW = 'discover-result-mal-anime-52991';

type GetTop = CatalogProvider['getTop'];

const answers =
  (page: Page<MediaSummary>): GetTop =>
  () =>
    Promise.resolve(page);

// rejects the first request with `error`, then answers `page`
const failsOnceWith = (error: Error, page: Page<MediaSummary>): GetTop => {
  let calls = 0;
  return () => {
    calls += 1;
    return calls === 1 ? Promise.reject(error) : Promise.resolve(page);
  };
};

describe('DiscoveryScreen rows and states', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    mockPush.mockClear();
    user = userEvent.setup();
  });

  it('opens the detail of a pressed top anime', async () => {
    await renderDiscoveryScreen();
    await advance(0);

    await user.press(screen.getByTestId(rowOf('anime', 1)));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/media/[namespace]/[kind]/[id]',
      params: { namespace: 'mal', kind: 'anime', id: '1001' },
    });
  });

  it('opens a top manga with its own kind and id', async () => {
    await renderDiscoveryScreen();
    await advance(0);
    await user.press(screen.getByRole('radio', { name: 'Top manga' }));
    await advance(0);

    await user.press(screen.getByTestId(rowOf('manga', 1)));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/media/[namespace]/[kind]/[id]',
      params: { namespace: 'mal', kind: 'manga', id: '2001' },
    });
  });

  it('BR-06: hides the adult titles and says how many were hidden', async () => {
    await renderDiscoveryScreen({ getTop: answers(pageOf(adultItem(1), FRIEREN, adultItem(2))) });
    await advance(0);

    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
    expect(screen.queryByTestId('discover-result-mal-anime-1')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('discover-result-mal-anime-2')).not.toBeOnTheScreen();
    expect(screen.getByTestId('discover-hidden-note')).toHaveTextContent(
      '2 adult titles were hidden.',
    );
  });

  it('BR-06: shows the adult titles while the setting is on', async () => {
    await renderDiscoveryScreen({
      getTop: answers(pageOf(adultItem(1), FRIEREN)),
      showAdult: true,
    });
    await advance(0);

    expect(screen.getByTestId('discover-result-mal-anime-1')).toBeOnTheScreen();
    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
    expect(screen.queryByTestId('discover-hidden-note')).not.toBeOnTheScreen();
  });

  it('shows the discovery empty state for an empty list', async () => {
    await renderDiscoveryScreen({ getTop: answers(pageOf()) });
    await advance(0);

    expect(screen.getByTestId('discover-empty')).toBeOnTheScreen();
    expect(screen.getByText('No titles')).toBeOnTheScreen();
    expect(screen.getByText('This list is empty for now.')).toBeOnTheScreen();
  });

  it('shows the offline error, then the list after a retry', async () => {
    const { provider } = await renderDiscoveryScreen({
      getTop: failsOnceWith(new CatalogNetworkError(), pageOf(FRIEREN)),
    });
    await advance(0);

    expect(screen.getByTestId('discover-error')).toBeOnTheScreen();
    expect(screen.getByText('You are offline')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Try again' }));
    await advance(0);

    expect(screen.queryByTestId('discover-error')).not.toBeOnTheScreen();
    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
    expect(foregroundTops(provider)).toStrictEqual([
      { kind: 'anime', page: 1 },
      { kind: 'anime', page: 1 },
    ]);
  });

  it('shows the generic error for a failed response', async () => {
    await renderDiscoveryScreen({
      getTop: () => Promise.reject(new CatalogHttpError(HTTP_SERVICE_UNAVAILABLE, null)),
    });
    await advance(0);

    expect(screen.getByText('Results could not be loaded')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });
});
