import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import {
  advance,
  foregroundSeasons,
  foregroundTops,
  renderDiscoveryScreen,
} from '../../../test/mobile/render-discovery-screen';
import { LAST_PAGE, rowOf } from './__fixtures__/discovery-pages';

// fR-04, C-08: the pages of the discovery lists, which belong to their section and format

// the screen pushes the detail route when a row is opened (DiscoveryScreen.open.test.tsx)
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ push: jest.fn() }),
}));

const JUMP_PAGE = 3;

const currentPage = (page: number) =>
  screen.getByRole('button', {
    name: `Page ${String(page)} of ${String(LAST_PAGE)}, current page`,
  });

describe('DiscoveryScreen pagination (FR-04)', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  const pressAndSettle = async (name: string) => {
    await user.press(screen.getByRole('button', { name }));
    await advance(0);
  };

  const jumpTo = async (page: number) => {
    await user.type(screen.getByLabelText('Go to page'), String(page), { submitEditing: true });
    await advance(0);
  };

  it('requests the page asked for and shows it', async () => {
    const { provider } = await renderDiscoveryScreen();
    await advance(0);
    expect(currentPage(1)).toBeOnTheScreen();

    await jumpTo(JUMP_PAGE);

    expect(currentPage(JUMP_PAGE)).toBeOnTheScreen();
    expect(screen.getByTestId(rowOf('anime', JUMP_PAGE))).toBeOnTheScreen();
    expect(foregroundTops(provider)).toStrictEqual([
      { kind: 'anime', page: 1 },
      { kind: 'anime', page: JUMP_PAGE },
    ]);
  });

  it('prefetches the next page of the list shown only, in the background', async () => {
    const { provider } = await renderDiscoveryScreen();
    await advance(0);

    expect(provider.getTop).toHaveBeenCalledWith(
      { kind: 'anime', page: 2 },
      expect.any(AbortSignal),
      { priority: 'background' },
    );
    expect(provider.getTop).toHaveBeenCalledTimes(2);
    expect(provider.getCurrentSeason).not.toHaveBeenCalled();

    // the prefetched page opens from the cache
    await pressAndSettle('Next page');

    expect(screen.getByTestId(rowOf('anime', 2))).toBeOnTheScreen();
    expect(foregroundTops(provider)).toStrictEqual([{ kind: 'anime', page: 1 }]);
  });

  it('goes back to page 1 when the manga format changes', async () => {
    const { provider } = await renderDiscoveryScreen();
    await advance(0);
    await pressAndSettle('Top manga');
    await jumpTo(JUMP_PAGE);
    expect(currentPage(JUMP_PAGE)).toBeOnTheScreen();

    await user.press(screen.getByTestId('discover-format-manhwa'));
    await advance(0);

    expect(currentPage(1)).toBeOnTheScreen();
    expect(foregroundTops(provider).slice(-2)).toStrictEqual([
      { kind: 'manga', page: JUMP_PAGE },
      { kind: 'manga', format: 'manhwa', page: 1 },
    ]);
  });

  it('goes back to page 1 when the section changes', async () => {
    const { provider } = await renderDiscoveryScreen();
    await advance(0);
    await jumpTo(JUMP_PAGE);

    await pressAndSettle('This season');

    expect(currentPage(1)).toBeOnTheScreen();
    expect(screen.getByTestId(rowOf('season', 1))).toBeOnTheScreen();
    expect(foregroundSeasons(provider)).toStrictEqual([1]);
  });

  it('does not bring back the old page of a section shown again', async () => {
    const { provider } = await renderDiscoveryScreen();
    await advance(0);
    await jumpTo(JUMP_PAGE);
    await pressAndSettle('Top manga');

    await pressAndSettle('Top anime');

    expect(currentPage(1)).toBeOnTheScreen();
    expect(screen.getByTestId(rowOf('anime', 1))).toBeOnTheScreen();
    expect(foregroundTops(provider).at(-1)).toStrictEqual({ kind: 'manga', page: 1 });
  });
});
