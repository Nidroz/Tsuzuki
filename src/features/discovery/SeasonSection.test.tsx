import type { CatalogProvider, MediaSummary } from '@core/catalog/catalog-provider';
import { describe, expect, it, jest } from '@jest/globals';
import { screen } from '@testing-library/react-native';

import {
  createStrictFakeCatalogProvider,
  EMPTY_PAGE,
} from '@core/catalog/__fixtures__/fake-catalog-provider';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { advance } from '../../../test/mobile/render-discovery-screen';
import { answersEverySeasonPage, rowOf } from './__fixtures__/discovery-pages';
import { SeasonSection } from './SeasonSection';

const PAGE = 2;

const renderSection = async (
  getCurrentSeason: CatalogProvider['getCurrentSeason'] = answersEverySeasonPage,
) => {
  const provider = createStrictFakeCatalogProvider({ getCurrentSeason });
  await renderWithProviders(
    <SeasonSection
      showAdult={false}
      currentPage={PAGE}
      onPageChange={jest.fn<(page: number) => void>()}
      onOpen={jest.fn<(item: MediaSummary) => void>()}
      scrollToTopKey="season"
    />,
    { catalogProvider: provider },
  );
  await advance(0);
  return { provider };
};

describe('SeasonSection', () => {
  it('shows the requested page of the current season, not a top list', async () => {
    const { provider } = await renderSection();

    expect(provider.getCurrentSeason).toHaveBeenCalledWith(PAGE, expect.any(AbortSignal));
    expect(provider.getTop).not.toHaveBeenCalled();
    expect(screen.getByTestId(rowOf('season', PAGE))).toBeOnTheScreen();
  });

  it('shows the discovery empty state for an empty page', async () => {
    await renderSection(() => Promise.resolve(EMPTY_PAGE));

    expect(screen.getByTestId('discover-empty')).toBeOnTheScreen();
    expect(screen.getByText('No titles')).toBeOnTheScreen();
  });
});
