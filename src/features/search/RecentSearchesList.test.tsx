import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent, within } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { RecentSearchesList } from './RecentSearchesList';

const SEARCHES = ['frieren', 'Solo Leveling', 'mushishi'] as const;
const CLEAR_LABEL = 'Clear recent searches';

const renderList = (
  searches: readonly string[],
  onSelect = jest.fn<(query: string) => void>(),
  onClear = jest.fn<() => void>(),
) =>
  renderWithProviders(
    <RecentSearchesList searches={searches} onSelect={onSelect} onClear={onClear} />,
  );

describe('RecentSearchesList', () => {
  it('shows a hint to type a title, and no clear button, without recent searches', async () => {
    await renderList([]);

    expect(screen.getByTestId('search-idle')).toBeOnTheScreen();
    expect(screen.getByText('Search anime and manga')).toBeOnTheScreen();
    expect(screen.getByText('Type a title to find it.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: CLEAR_LABEL })).not.toBeOnTheScreen();
  });

  it('lists the recent searches newest first, each a button named by its text', async () => {
    await renderList(SEARCHES);

    const recent = screen.getByTestId('search-recent');
    expect(within(recent).getByText('Recent searches')).toBeOnTheScreen();
    SEARCHES.forEach((query, index) => {
      expect(screen.getByTestId(`search-recent-${String(index)}`)).toBe(
        screen.getByRole('button', { name: query }),
      );
    });
    expect(screen.queryByTestId('search-idle')).not.toBeOnTheScreen();
  });

  it('searches an entry again when it is pressed', async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn<(query: string) => void>();
    await renderList(SEARCHES, onSelect);

    await user.press(screen.getByRole('button', { name: 'Solo Leveling' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('Solo Leveling');
  });

  it('clears the list with a button whose name says what it clears', async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn<(query: string) => void>();
    const onClear = jest.fn<() => void>();
    await renderList(SEARCHES, onSelect, onClear);

    const clear = screen.getByRole('button', { name: CLEAR_LABEL });
    expect(clear).toHaveTextContent('Clear');
    await user.press(clear);

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('is translated in french', async () => {
    await renderWithProviders(
      <RecentSearchesList searches={SEARCHES} onSelect={jest.fn()} onClear={jest.fn()} />,
      { language: 'fr' },
    );

    expect(screen.getByText('Recherches récentes')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Effacer les recherches récentes' }),
    ).toBeOnTheScreen();
  });
});
