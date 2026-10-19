import type { CatalogProvider, MediaSummary } from '@core/catalog/catalog-provider';
import { CatalogNetworkError } from '@core/errors/catalog-errors';
import { useTopMedia } from '@core/hooks/use-top-media';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import {
  createStrictFakeCatalogProvider,
  EMPTY_PAGE,
} from '@core/catalog/__fixtures__/fake-catalog-provider';
import { advance, foregroundTops } from '../../../test/mobile/render-discovery-screen';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { answersEveryTopPage, LAST_PAGE, rowOf } from './__fixtures__/discovery-pages';
import { DiscoveryPageList } from './DiscoveryPageList';

// the list of a discovery section: MediaPageList with the discovery test ids, empty state and
// retry, fed by a real hook result

type GetTop = CatalogProvider['getTop'];

const PAGE = 2;
// the accessible name of the row of page PAGE of the top anime (discovery-pages.ts)
const ROW_NAME = `anime page ${String(PAGE)}, TV, 2023, Score 9.24`;

interface HarnessProps {
  readonly onOpen: (item: MediaSummary) => void;
  readonly onPageChange: (page: number) => void;
}

// the result of the top anime hook at PAGE, given to the list as a section does
function Harness({ onOpen, onPageChange }: HarnessProps) {
  const result = useTopMedia({ kind: 'anime', page: PAGE }, { showAdult: false });
  return (
    <DiscoveryPageList
      result={result}
      currentPage={PAGE}
      onPageChange={onPageChange}
      onOpen={onOpen}
      scrollToTopKey="top-anime#2"
    />
  );
}

const renderList = async (getTop: GetTop = answersEveryTopPage) => {
  const provider = createStrictFakeCatalogProvider({ getTop });
  const onOpen = jest.fn<(item: MediaSummary) => void>();
  const onPageChange = jest.fn<(page: number) => void>();
  await renderWithProviders(<Harness onOpen={onOpen} onPageChange={onPageChange} />, {
    catalogProvider: provider,
  });
  await advance(0);
  return { provider, onOpen, onPageChange };
};

describe('DiscoveryPageList', () => {
  it('shows the page under the discovery test ids, its rows named for screen readers', async () => {
    await renderList();

    expect(screen.getByTestId('discover-results')).toBeOnTheScreen();
    expect(screen.getByTestId(rowOf('anime', PAGE))).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: ROW_NAME })).toBeOnTheScreen();
    expect(screen.getByTestId('discover-pagination')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', {
        name: `Page ${String(PAGE)} of ${String(LAST_PAGE)}, current page`,
      }),
    ).toBeOnTheScreen();
  });

  it('opens the pressed row and asks for the pressed page', async () => {
    const user = userEvent.setup();
    const { onOpen, onPageChange } = await renderList();

    await user.press(screen.getByRole('button', { name: ROW_NAME }));
    await user.press(screen.getByRole('button', { name: 'Previous page' }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[0]?.title).toBe(`anime page ${String(PAGE)}`);
    expect(onPageChange).toHaveBeenCalledWith(PAGE - 1);
  });

  it('shows the discovery empty state for an empty page, with the pages to go back', async () => {
    await renderList(() => Promise.resolve(EMPTY_PAGE));

    expect(screen.getByTestId('discover-empty')).toBeOnTheScreen();
    expect(screen.getByText('No titles')).toBeOnTheScreen();
    expect(screen.getByText('This list has no titles here for now.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeOnTheScreen();
  });

  it('retries a failed page through the hook, then shows it', async () => {
    const user = userEvent.setup();
    const getTop = jest
      .fn<GetTop>()
      .mockRejectedValueOnce(new CatalogNetworkError())
      .mockImplementation(answersEveryTopPage);
    const { provider } = await renderList(getTop);
    expect(screen.getByTestId('discover-error')).toBeOnTheScreen();
    expect(screen.getByText('You are offline')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Try again' }));
    await advance(0);

    expect(foregroundTops(provider)).toStrictEqual([
      { kind: 'anime', page: PAGE },
      { kind: 'anime', page: PAGE },
    ]);
    expect(screen.queryByTestId('discover-error')).not.toBeOnTheScreen();
    expect(screen.getByTestId(rowOf('anime', PAGE))).toBeOnTheScreen();
  });
});
