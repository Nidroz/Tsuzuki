import type { SearchSortField, SortDirection } from '@core/catalog/catalog-provider';
import type { SearchableMediaFormat, SearchableMediaStatus } from '@core/domain/media';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { FormatFilter } from './FormatFilter';
import { MinScoreFilter } from './MinScoreFilter';
import { SortFilter, type SortFilterProps } from './SortFilter';
import { StatusFilter } from './StatusFilter';
import { YearFilter } from './YearFilter';

// the single-select sections of the filters sheet and its year field, each alone; the sheet
// itself is tested in FiltersSheet.test.tsx

const radioNames = () =>
  screen.getAllByRole('radio').map((radio) => radio.props.accessibilityLabel as string);

describe('FormatFilter', () => {
  it('offers the searchable anime formats, without unknown', async () => {
    await renderWithProviders(<FormatFilter kind="anime" format={null} onChange={jest.fn()} />);

    expect(screen.getByRole('header', { name: 'Format' })).toBeOnTheScreen();
    expect(radioNames()).toStrictEqual(['Any', 'TV', 'Movie', 'OVA', 'ONA', 'Special', 'Music']);
    expect(screen.getByRole('radio', { name: 'Any' })).toBe(
      screen.getByTestId('filters-format-none'),
    );
    expect(screen.getByRole('radio', { name: 'Any' })).toBeChecked();
  });

  it('offers the searchable manga formats, without oel and unknown', async () => {
    await renderWithProviders(<FormatFilter kind="manga" format={null} onChange={jest.fn()} />);

    expect(radioNames()).toStrictEqual([
      'Any',
      'Manga',
      'Manhwa',
      'Manhua',
      'Light novel',
      'Novel',
      'One-shot',
      'Doujinshi',
    ]);
  });

  it('selects the format, keeps it when its chip is pressed again, and clears it with Any', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn<(format: SearchableMediaFormat | null) => void>();
    await renderWithProviders(<FormatFilter kind="anime" format="movie" onChange={onChange} />);

    expect(screen.getByRole('radio', { name: 'Movie' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Any' })).not.toBeChecked();

    await user.press(screen.getByRole('radio', { name: 'Movie' }));
    await user.press(screen.getByRole('radio', { name: 'TV' }));
    await user.press(screen.getByRole('radio', { name: 'Any' }));

    expect(onChange.mock.calls).toStrictEqual([['movie'], ['tv'], [null]]);
  });
});

describe('StatusFilter', () => {
  it('words the statuses for anime', async () => {
    await renderWithProviders(<StatusFilter kind="anime" status={null} onChange={jest.fn()} />);

    expect(screen.getByRole('header', { name: 'Status' })).toBeOnTheScreen();
    expect(radioNames()).toStrictEqual(['Any', 'Airing', 'Finished', 'Upcoming']);
    expect(screen.getByRole('radio', { name: 'Any' })).toBe(
      screen.getByTestId('filters-status-none'),
    );
  });

  it('words the statuses for manga, in french too', async () => {
    await renderWithProviders(<StatusFilter kind="manga" status="ongoing" onChange={jest.fn()} />, {
      language: 'fr',
    });

    expect(radioNames()).toStrictEqual([
      'Indifférent',
      'En cours de publication',
      'Terminé',
      'À venir',
    ]);
    expect(screen.getByRole('header', { name: 'Statut' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'En cours de publication' })).toBeChecked();
  });

  it('selects a status, keeps it when its chip is pressed again, and clears it with Any', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn<(status: SearchableMediaStatus | null) => void>();
    await renderWithProviders(<StatusFilter kind="manga" status="finished" onChange={onChange} />);

    await user.press(screen.getByRole('radio', { name: 'Finished' }));
    await user.press(screen.getByRole('radio', { name: 'Upcoming' }));
    await user.press(screen.getByRole('radio', { name: 'Any' }));

    expect(onChange.mock.calls).toStrictEqual([['finished'], ['upcoming'], [null]]);
  });
});

describe('MinScoreFilter', () => {
  it('shows 5+ to 9+, each read as a score or more', async () => {
    await renderWithProviders(<MinScoreFilter minScore={7} onChange={jest.fn()} />);

    expect(screen.getByRole('header', { name: 'Minimum score' })).toBeOnTheScreen();
    expect(radioNames()).toStrictEqual([
      'Any',
      'Score 5 or more',
      'Score 6 or more',
      'Score 7 or more',
      'Score 8 or more',
      'Score 9 or more',
    ]);
    expect(screen.getByTestId('filters-min-score-7')).toHaveTextContent('7+');
    expect(screen.getByRole('radio', { name: 'Score 7 or more' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Any' })).toBe(
      screen.getByTestId('filters-min-score-none'),
    );
  });

  it('selects a score, keeps it when its chip is pressed again, and clears it with Any', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn<(minScore: number | null) => void>();
    await renderWithProviders(<MinScoreFilter minScore={7} onChange={onChange} />);

    await user.press(screen.getByRole('radio', { name: 'Score 7 or more' }));
    await user.press(screen.getByRole('radio', { name: 'Score 9 or more' }));
    await user.press(screen.getByRole('radio', { name: 'Any' }));

    expect(onChange.mock.calls).toStrictEqual([[7], [9], [null]]);
  });
});

describe('SortFilter', () => {
  const renderSort = async (sort: SortFilterProps['sort']) => {
    const onFieldChange = jest.fn<(field: SearchSortField | null) => void>();
    const onDirectionChange = jest.fn<(direction: SortDirection) => void>();
    await renderWithProviders(
      <SortFilter
        sort={sort}
        onFieldChange={onFieldChange}
        onDirectionChange={onDirectionChange}
      />,
    );
    return { onFieldChange, onDirectionChange };
  };

  it('selects relevance and hides the direction while no field is chosen', async () => {
    await renderSort(null);

    expect(radioNames()).toStrictEqual(['Relevance', 'Score', 'Popularity', 'Title', 'Start date']);
    expect(screen.getByRole('header', { name: 'Sort by' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Relevance' })).toBeChecked();
    expect(screen.queryByText('Order')).not.toBeOnTheScreen();
  });

  it('shows the direction of the chosen field', async () => {
    await renderSort({ field: 'title', direction: 'asc' });

    expect(screen.getByRole('radio', { name: 'Title' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Relevance' })).not.toBeChecked();
    expect(screen.getByText('Order')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Ascending' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Descending' })).not.toBeChecked();
  });

  it('asks for a field, relevance and a direction; the chosen field is kept', async () => {
    const user = userEvent.setup();
    const { onFieldChange, onDirectionChange } = await renderSort({
      field: 'score',
      direction: 'desc',
    });

    await user.press(screen.getByRole('radio', { name: 'Score' }));
    await user.press(screen.getByRole('radio', { name: 'Popularity' }));
    await user.press(screen.getByRole('radio', { name: 'Relevance' }));
    await user.press(screen.getByRole('radio', { name: 'Ascending' }));
    await user.press(screen.getByRole('radio', { name: 'Descending' }));

    expect(onFieldChange.mock.calls).toStrictEqual([['score'], ['popularity'], [null]]);
    expect(onDirectionChange.mock.calls).toStrictEqual([['asc'], ['desc']]);
  });
});

describe('YearFilter', () => {
  it('is a labelled numeric field of four digits, without an error', async () => {
    await renderWithProviders(<YearFilter text="" invalid={false} onChangeText={jest.fn()} />);

    const field = screen.getByTestId('filters-year');

    expect(field).toHaveAccessibleName('From year');
    expect(field).toHaveProp('keyboardType', 'number-pad');
    expect(field).toHaveProp('maxLength', 4);
    expect(field).toHaveProp('placeholder', 'YYYY');
    expect(screen.queryByTestId('filters-year-error')).not.toBeOnTheScreen();
  });

  it('shows the translated error when the text is invalid', async () => {
    await renderWithProviders(<YearFilter text="99" invalid onChangeText={jest.fn()} />);

    expect(screen.getByTestId('filters-year-error')).toHaveTextContent(
      'Enter a year of four digits, from 1000 to 9999.',
    );
  });

  it('passes the typed text on', async () => {
    const user = userEvent.setup();
    const onChangeText = jest.fn<(text: string) => void>();
    await renderWithProviders(<YearFilter text="" invalid={false} onChangeText={onChangeText} />);

    await user.type(screen.getByTestId('filters-year'), '2');

    expect(onChangeText).toHaveBeenLastCalledWith('2');
  });
});
