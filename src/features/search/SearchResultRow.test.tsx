import type { MediaSummary } from '@core/catalog/catalog-provider';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { FRIEREN, FRIEREN_GOLDEN_LAND, SOLO_LEVELING } from './__fixtures__/search-results';
import { SearchResultRow, searchResultKey } from './SearchResultRow';

const FRIEREN_TEST_ID = 'search-result-mal-anime-52991';
const OPEN_HINT = 'Opens the details';

const coverImage = (testID: string) =>
  screen.queryByTestId(`${testID}-cover-image`, { includeHiddenElements: true });
const coverPlaceholder = (testID: string) =>
  screen.queryByTestId(`${testID}-cover-placeholder`, { includeHiddenElements: true });

const renderRow = (item: MediaSummary, onOpen = jest.fn<(item: MediaSummary) => void>()) =>
  renderWithProviders(<SearchResultRow item={item} onOpen={onOpen} />);

describe('SearchResultRow', () => {
  it('is a button named by its title, english title, format, year and score, with a hint', async () => {
    await renderRow(FRIEREN);

    const row = screen.getByRole('button', {
      name: "Sousou no Frieren, Frieren: Beyond Journey's End, TV, 2023, Score 9.24",
    });
    expect(row).toHaveProp('testID', FRIEREN_TEST_ID);
    expect(row).toHaveProp('accessibilityHint', OPEN_HINT);
    expect(screen.getByText('Sousou no Frieren')).toBeOnTheScreen();
    expect(screen.getByText("Frieren: Beyond Journey's End")).toBeOnTheScreen();
    expect(screen.getByText('TV')).toBeOnTheScreen();
    // a year has no digit grouping
    expect(screen.getByText('2023')).toBeOnTheScreen();
    expect(screen.getByText('Score 9.24')).toBeOnTheScreen();
  });

  it('opens its own item when pressed', async () => {
    const user = userEvent.setup();
    const onOpen = jest.fn<(item: MediaSummary) => void>();
    await renderRow(FRIEREN, onOpen);

    await user.press(screen.getByTestId(FRIEREN_TEST_ID));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(FRIEREN);
  });

  it('leaves out an english title equal to the title, ignoring case', async () => {
    await renderRow({ ...SOLO_LEVELING, titleEnglish: 'SOLO LEVELING' });

    expect(
      screen.getByRole('button', { name: 'Solo Leveling, Manhwa, 2018, Score 8.55' }),
    ).toBeOnTheScreen();
    expect(screen.queryByText('SOLO LEVELING')).not.toBeOnTheScreen();
  });

  it('leaves out a missing english title, year and score', async () => {
    await renderRow({ ...FRIEREN_GOLDEN_LAND, titleEnglish: null, year: null });

    expect(
      screen.getByRole('button', { name: 'Sousou no Frieren: Ougonkyou-hen, TV' }),
    ).toBeOnTheScreen();
  });

  it('loads exactly the item cover url, with no placeholder', async () => {
    await renderRow(FRIEREN);

    expect(coverImage(FRIEREN_TEST_ID)?.props.source).toStrictEqual([{ uri: FRIEREN.imageUrl }]);
    expect(coverPlaceholder(FRIEREN_TEST_ID)).not.toBeOnTheScreen();
  });

  it('shows the placeholder and no image without a cover url', async () => {
    await renderRow({ ...FRIEREN, imageUrl: null });

    expect(coverImage(FRIEREN_TEST_ID)).toBeNull();
    expect(coverPlaceholder(FRIEREN_TEST_ID)).not.toBeNull();
  });

  it('translates the format and formats the score in french', async () => {
    await renderWithProviders(
      <SearchResultRow item={{ ...FRIEREN, format: 'movie' }} onOpen={jest.fn()} />,
      { language: 'fr' },
    );

    expect(
      screen.getByRole('button', {
        name: "Sousou no Frieren, Frieren: Beyond Journey's End, Film, 2023, Note 9,24",
      }),
    ).toHaveProp('accessibilityHint', 'Ouvre les détails');
  });
});

describe('searchResultKey', () => {
  it('is the media key: namespace, kind and id', () => {
    expect(searchResultKey(FRIEREN)).toBe('mal:anime:52991');
    expect(searchResultKey(SOLO_LEVELING)).toBe('mal:manga:121496');
  });
});
