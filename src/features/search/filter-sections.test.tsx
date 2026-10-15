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

const buttonNames = () =>
  screen.getAllByRole('button').map((button) => button.props.accessibilityLabel as string);

describe('FormatFilter', () => {
  it('offers the searchable anime formats, without unknown', async () => {
    await renderWithProviders(<FormatFilter kind="anime" format={null} onChange={jest.fn()} />);

    expect(screen.getByText('Format')).toBeOnTheScreen();
    expect(buttonNames()).toStrictEqual(['TV', 'Movie', 'OVA', 'ONA', 'Special', 'Music']);
  });

  it('offers the searchable manga formats, without oel and unknown', async () => {
    await renderWithProviders(<FormatFilter kind="manga" format={null} onChange={jest.fn()} />);

    expect(buttonNames()).toStrictEqual([
      'Manga',
      'Manhwa',
      'Manhua',
      'Light novel',
      'Novel',
      'One-shot',
      'Doujinshi',
    ]);
  });

  it('selects the format, and clears it when its chip is pressed again', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn<(format: SearchableMediaFormat | null) => void>();
    await renderWithProviders(<FormatFilter kind="anime" format="movie" onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'Movie' })).toBeSelected();

    await user.press(screen.getByRole('button', { name: 'Movie' }));
    await user.press(screen.getByRole('button', { name: 'TV' }));

    expect(onChange.mock.calls).toStrictEqual([[null], ['tv']]);
  });
});

describe('StatusFilter', () => {
  it('words the statuses for anime', async () => {
    await renderWithProviders(<StatusFilter kind="anime" status={null} onChange={jest.fn()} />);

    expect(screen.getByText('Status')).toBeOnTheScreen();
    expect(buttonNames()).toStrictEqual(['Airing', 'Finished', 'Upcoming']);
  });

  it('words the statuses for manga, in french too', async () => {
    await renderWithProviders(<StatusFilter kind="manga" status="ongoing" onChange={jest.fn()} />, {
      language: 'fr',
    });

    expect(buttonNames()).toStrictEqual(['En cours de publication', 'Terminé', 'À venir']);
    expect(screen.getByRole('button', { name: 'En cours de publication' })).toBeSelected();
  });

  it('selects a status, and clears it when its chip is pressed again', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn<(status: SearchableMediaStatus | null) => void>();
    await renderWithProviders(<StatusFilter kind="manga" status="finished" onChange={onChange} />);

    await user.press(screen.getByRole('button', { name: 'Finished' }));
    await user.press(screen.getByRole('button', { name: 'Upcoming' }));

    expect(onChange.mock.calls).toStrictEqual([[null], ['upcoming']]);
  });
});

describe('MinScoreFilter', () => {
  it('shows 5+ to 9+, each read as a score or more', async () => {
    await renderWithProviders(<MinScoreFilter minScore={7} onChange={jest.fn()} />);

    expect(screen.getByText('Minimum score')).toBeOnTheScreen();
    expect(buttonNames()).toStrictEqual([
      'Score 5 or more',
      'Score 6 or more',
      'Score 7 or more',
      'Score 8 or more',
      'Score 9 or more',
    ]);
    expect(screen.getByTestId('filters-min-score-7')).toHaveTextContent('7+');
    expect(screen.getByRole('button', { name: 'Score 7 or more' })).toBeSelected();
  });

  it('selects a score, and clears it when its chip is pressed again', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn<(minScore: number | null) => void>();
    await renderWithProviders(<MinScoreFilter minScore={7} onChange={onChange} />);

    await user.press(screen.getByRole('button', { name: 'Score 7 or more' }));
    await user.press(screen.getByRole('button', { name: 'Score 9 or more' }));

    expect(onChange.mock.calls).toStrictEqual([[null], [9]]);
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

    expect(buttonNames()).toStrictEqual([
      'Relevance',
      'Score',
      'Popularity',
      'Title',
      'Start date',
    ]);
    expect(screen.getByRole('button', { name: 'Relevance' })).toBeSelected();
    expect(screen.queryByText('Order')).not.toBeOnTheScreen();
  });

  it('shows the direction of the chosen field', async () => {
    await renderSort({ field: 'title', direction: 'asc' });

    expect(screen.getByRole('button', { name: 'Title' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Relevance' })).not.toBeSelected();
    expect(screen.getByText('Order')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Ascending' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Descending' })).not.toBeSelected();
  });

  it('asks for a field, relevance and a direction; the chosen field is kept', async () => {
    const user = userEvent.setup();
    const { onFieldChange, onDirectionChange } = await renderSort({
      field: 'score',
      direction: 'desc',
    });

    await user.press(screen.getByRole('button', { name: 'Score' }));
    await user.press(screen.getByRole('button', { name: 'Popularity' }));
    await user.press(screen.getByRole('button', { name: 'Relevance' }));
    await user.press(screen.getByRole('button', { name: 'Ascending' }));
    await user.press(screen.getByRole('button', { name: 'Descending' }));

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
