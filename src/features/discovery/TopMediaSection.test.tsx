import type { MediaSummary } from '@core/catalog/catalog-provider';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { createStrictFakeCatalogProvider } from '@core/catalog/__fixtures__/fake-catalog-provider';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { advance } from '../../../test/mobile/render-discovery-screen';
import { answersEveryTopPage, LAST_PAGE, rowOf } from './__fixtures__/discovery-pages';
import { TopMediaSection, type TopMediaSectionProps } from './TopMediaSection';

const PAGE = 2;

const renderSection = async (props: Partial<TopMediaSectionProps> = {}) => {
  const provider = createStrictFakeCatalogProvider({ getTop: answersEveryTopPage });
  const onPageChange = jest.fn<(page: number) => void>();
  await renderWithProviders(
    <TopMediaSection
      kind="anime"
      format={null}
      showAdult={false}
      currentPage={PAGE}
      onPageChange={onPageChange}
      onOpen={jest.fn<(item: MediaSummary) => void>()}
      scrollToTopKey="top"
      {...props}
    />,
    { catalogProvider: provider },
  );
  await advance(0);
  return { provider, onPageChange };
};

describe('TopMediaSection', () => {
  it('shows the requested page of the top list of the kind, without a format key', async () => {
    const { provider } = await renderSection();

    expect(provider.getTop).toHaveBeenCalledWith(
      { kind: 'anime', page: PAGE },
      expect.any(AbortSignal),
    );
    expect(screen.getByTestId('discover-results')).toBeOnTheScreen();
    expect(screen.getByTestId(rowOf('anime', PAGE))).toBeOnTheScreen();
  });

  it('requests the top list of the given manga format', async () => {
    const { provider } = await renderSection({ kind: 'manga', format: 'light_novel' });

    expect(provider.getTop).toHaveBeenCalledWith(
      { kind: 'manga', format: 'light_novel', page: PAGE },
      expect.any(AbortSignal),
    );
    expect(screen.getByTestId(rowOf('manga', PAGE))).toBeOnTheScreen();
  });

  it('asks for the page pressed in its pagination', async () => {
    const user = userEvent.setup();
    const { onPageChange } = await renderSection();

    await user.press(screen.getByRole('button', { name: 'Next page' }));

    expect(onPageChange).toHaveBeenCalledWith(PAGE + 1);
    expect(
      screen.getByRole('button', {
        name: `Page ${String(PAGE)} of ${String(LAST_PAGE)}, current page`,
      }),
    ).toBeOnTheScreen();
  });
});
