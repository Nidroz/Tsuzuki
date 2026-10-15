import type { MediaSummary, Page } from '@core/catalog/catalog-provider';
import { SEARCH_DEBOUNCE_MS } from '@core/hooks/use-search';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';
import type { Href } from 'expo-router';

import {
  advance,
  renderSearchScreen,
  searchInput,
} from '../../../test/mobile/render-search-screen';
import { FRIEREN, pageOf, SOLO_LEVELING } from './__fixtures__/search-results';

// fR-02: what records a recent search, what searches one again, and how they are cleared; and
// opening a result

const mockPush = jest.fn<(href: Href) => void>();

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ push: mockPush }),
}));

const FRIEREN_ROW = 'search-result-mal-anime-52991';
const SOLO_LEVELING_ROW = 'search-result-mal-manga-121496';

const answers = (page: Page<MediaSummary>) => (): Promise<Page<MediaSummary>> =>
  Promise.resolve(page);

describe('SearchScreen recent searches (FR-02)', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    mockPush.mockClear();
    user = userEvent.setup();
  });

  it('lists the stored searches while the field is empty', async () => {
    await renderSearchScreen({ recentSearches: ['frieren', 'mushishi'] });

    expect(screen.getByRole('button', { name: 'frieren' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'mushishi' })).toBeOnTheScreen();
    expect(screen.queryByTestId('search-idle')).not.toBeOnTheScreen();
  });

  it('never records a search while typing, even once its results show', async () => {
    const { repository } = await renderSearchScreen({ search: answers(pageOf(FRIEREN)) });

    await user.type(searchInput(), 'frieren');
    await advance(SEARCH_DEBOUNCE_MS);

    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('records the prepared text on submit and searches it at once', async () => {
    const { provider, repository } = await renderSearchScreen({
      search: answers(pageOf(FRIEREN)),
      recentSearches: ['mushishi'],
    });

    await user.type(searchInput(), '  Frieren ', { submitEditing: true });
    await advance(0);

    expect(repository.stored()).toStrictEqual(['Frieren', 'mushishi']);
    // without the debounce
    expect(provider.search).toHaveBeenCalledWith(
      { kind: 'anime', query: 'Frieren', page: 1 },
      expect.any(AbortSignal),
    );
    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();
  });

  it('searches a recent search at once when it is pressed, with the selected kind', async () => {
    const { provider } = await renderSearchScreen({
      search: answers(pageOf(SOLO_LEVELING)),
      recentSearches: ['frieren', 'solo leveling'],
    });
    await user.press(screen.getByRole('button', { name: 'Manga' }));

    await user.press(screen.getByRole('button', { name: 'solo leveling' }));
    await advance(0);

    expect(searchInput()).toHaveDisplayValue('solo leveling');
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(provider.search).toHaveBeenCalledWith(
      { kind: 'manga', query: 'solo leveling', page: 1 },
      expect.any(AbortSignal),
    );
    expect(screen.getByTestId(SOLO_LEVELING_ROW)).toBeOnTheScreen();
  });

  it('clears the recent searches, stored ones included', async () => {
    const { repository } = await renderSearchScreen({ recentSearches: ['frieren', 'mushishi'] });

    await user.press(screen.getByRole('button', { name: 'Clear recent searches' }));

    expect(repository.clear).toHaveBeenCalledTimes(1);
    expect(repository.stored()).toStrictEqual([]);
    expect(screen.queryByRole('button', { name: 'frieren' })).not.toBeOnTheScreen();
    expect(screen.getByTestId('search-idle')).toBeOnTheScreen();
  });

  it('shows the recent searches again as soon as the field is cleared', async () => {
    await renderSearchScreen({
      search: answers(pageOf(FRIEREN)),
      recentSearches: ['mushishi'],
    });
    await user.type(searchInput(), 'frieren');
    await advance(SEARCH_DEBOUNCE_MS);
    expect(screen.getByTestId(FRIEREN_ROW)).toBeOnTheScreen();

    await user.clear(searchInput());

    expect(screen.getByRole('button', { name: 'mushishi' })).toBeOnTheScreen();
    expect(screen.queryByTestId(FRIEREN_ROW)).not.toBeOnTheScreen();
  });
});

describe('SearchScreen opening a result', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    mockPush.mockClear();
    user = userEvent.setup();
  });

  it('records the query of the results and opens the detail route of the item', async () => {
    const { repository } = await renderSearchScreen({ search: answers(pageOf(FRIEREN)) });
    await user.type(searchInput(), ' frieren');
    await advance(SEARCH_DEBOUNCE_MS);

    await user.press(screen.getByTestId(FRIEREN_ROW));

    expect(repository.stored()).toStrictEqual(['frieren']);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/media/[namespace]/[kind]/[id]',
      params: { namespace: 'mal', kind: 'anime', id: '52991' },
    });
  });

  it('opens a manga with its own kind and id', async () => {
    await renderSearchScreen({ search: answers(pageOf(SOLO_LEVELING)) });
    await user.press(screen.getByRole('button', { name: 'Manga' }));
    await user.type(searchInput(), 'solo leveling');
    await advance(SEARCH_DEBOUNCE_MS);

    await user.press(screen.getByTestId(SOLO_LEVELING_ROW));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/media/[namespace]/[kind]/[id]',
      params: { namespace: 'mal', kind: 'manga', id: '121496' },
    });
  });
});
