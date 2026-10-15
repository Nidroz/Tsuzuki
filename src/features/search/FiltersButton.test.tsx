import { EMPTY_SEARCH_FILTERS, type SearchFilters } from '@core/domain/search-filters';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { FiltersButton } from './FiltersButton';

const TWO_ACTIVE: SearchFilters = { ...EMPTY_SEARCH_FILTERS, format: 'tv', minScore: 7 };
const ONE_ACTIVE: SearchFilters = { ...EMPTY_SEARCH_FILTERS, yearFrom: 2015 };

describe('FiltersButton', () => {
  it('says Filters without a count while no filter is active', async () => {
    await renderWithProviders(<FiltersButton filters={EMPTY_SEARCH_FILTERS} onPress={jest.fn()} />);

    const button = screen.getByRole('button', { name: 'Filters' });

    expect(button).toHaveTextContent('Filters');
    expect(button).toHaveProp('accessibilityHint', 'Opens the search filters');
  });

  it('shows the active count, and reads it in its accessibility label', async () => {
    await renderWithProviders(<FiltersButton filters={TWO_ACTIVE} onPress={jest.fn()} />);

    const button = screen.getByRole('button', { name: 'Filters, 2 active' });

    expect(button).toHaveTextContent('Filters (2)');
    expect(button).toBe(screen.getByTestId('search-filters'));
  });

  it('opens the sheet when pressed', async () => {
    const user = userEvent.setup();
    const onPress = jest.fn();
    await renderWithProviders(<FiltersButton filters={ONE_ACTIVE} onPress={onPress} />);

    await user.press(screen.getByRole('button', { name: 'Filters, 1 active' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is translated in french, with the plural of the count', async () => {
    const { rerender } = await renderWithProviders(
      <FiltersButton filters={ONE_ACTIVE} onPress={jest.fn()} />,
      { language: 'fr' },
    );

    expect(screen.getByRole('button', { name: 'Filtres, 1 actif' })).toHaveTextContent(
      'Filtres (1)',
    );

    await rerender(<FiltersButton filters={TWO_ACTIVE} onPress={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Filtres, 2 actifs' })).toBeOnTheScreen();
  });
});
