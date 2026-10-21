import { createQueryClient } from '@core/query/query-client';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, within } from '@testing-library/react-native';
import type { Href } from 'expo-router';

import {
  createDeferred,
  createFakeLibraryRepository,
} from '../../../test/core/fake-library-repository';
import {
  renderLibraryScreen,
  settle,
  textsInListOrder,
} from '../../../test/mobile/render-library-screen';
import { BERSERK, FRIEREN, LIBRARY } from './__fixtures__/library-entries';

// fR-14: the states and the filters of the library screen; the rows are in LibraryScreen.rows

const mockNavigate = jest.fn<(href: Href) => void>();

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ push: jest.fn(), navigate: mockNavigate }),
}));

const READ_FAILURE = new Error('storage is unreadable');
const TITLES = /^(?:Sousou no Frieren|Berserk|Monster|Mushishi)$/u;
const HEADERS_AND_TITLES =
  /^(?:(?:In progress|Planned|Completed|Watching|Reading|Plan to watch) \(\d+\)|Sousou no Frieren|Berserk|Monster|Mushishi)$/u;

// the section headers and the row titles, in the list order
const shownInOrder = () => textsInListOrder(HEADERS_AND_TITLES);
const titlesInOrder = () => textsInListOrder(TITLES);
const radio = (name: string) => screen.getByRole('radio', { name });

describe('LibraryScreen', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('shows each status group in order under its header and count (FR-14)', async () => {
    await renderLibraryScreen();
    await settle();

    expect(shownInOrder()).toStrictEqual([
      'In progress (2)',
      'Sousou no Frieren',
      'Berserk',
      'Planned (1)',
      'Monster',
      'Completed (1)',
      'Mushishi',
    ]);
    // the headers are announced as headings
    expect(screen.getAllByRole('header')).toHaveLength(3);
    for (const name of ['In progress (2)', 'Planned (1)', 'Completed (1)']) {
      expect(screen.getByRole('header', { name })).toBeOnTheScreen();
    }
  });

  it('offers kind, status and sort as named radio groups, every kind and status at first', async () => {
    await renderLibraryScreen();
    await settle();

    for (const [testID, label] of [
      ['library-filters-kind', 'Type'],
      ['library-filters-status', 'Status'],
      ['library-filters-sort', 'Sort by'],
    ] as const) {
      expect(screen.getByTestId(testID)).toHaveProp('accessibilityRole', 'radiogroup');
      expect(screen.getByTestId(testID)).toHaveProp('accessibilityLabel', label);
    }
    const status = within(screen.getByTestId('library-filters-status'));
    expect(
      status.getAllByRole('radio').map((chip) => String(chip.props.accessibilityLabel)),
    ).toStrictEqual(['All', 'In progress', 'Planned', 'Completed', 'Paused', 'Dropped']);
    expect(
      within(screen.getByTestId('library-filters-kind')).getByRole('radio', { name: 'All' }),
    ).toBeChecked();
    expect(status.getByRole('radio', { name: 'All' })).toBeChecked();
    expect(radio('Last updated')).toBeChecked();
  });

  it('shows one kind with its own status words', async () => {
    const { user } = await renderLibraryScreen();
    await settle();

    await user.press(radio('Manga'));

    expect(radio('Manga')).toBeChecked();
    expect(shownInOrder()).toStrictEqual(['Reading (1)', 'Berserk']);
    expect(radio('Reading')).toBeOnTheScreen();
    expect(radio('Plan to read')).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: 'In progress' })).not.toBeOnTheScreen();
  });

  it('shows one status as a single group', async () => {
    const { user } = await renderLibraryScreen();
    await settle();

    await user.press(radio('Planned'));

    expect(radio('Planned')).toBeChecked();
    expect(shownInOrder()).toStrictEqual(['Planned (1)', 'Monster']);
  });

  it('sorts each group by title or by score, and never reads the library again', async () => {
    const { user, repository } = await renderLibraryScreen();
    await settle();

    await user.press(radio('Title'));

    expect(radio('Title')).toBeChecked();
    expect(titlesInOrder()).toStrictEqual(['Berserk', 'Sousou no Frieren', 'Monster', 'Mushishi']);

    await user.press(radio('My score'));

    // berserk has no score: last of its group
    expect(titlesInOrder()).toStrictEqual(['Sousou no Frieren', 'Berserk', 'Monster', 'Mushishi']);
    expect(repository.list).toHaveBeenCalledTimes(1);
  });

  it('shows a labelled spinner while the library loads', async () => {
    const read = createDeferred();
    const repository = createFakeLibraryRepository(LIBRARY);
    repository.beforeCall.mockReturnValueOnce(read.promise);
    await renderLibraryScreen({ repository });

    expect(screen.getByLabelText('Loading your library')).toHaveProp('testID', 'library-loading');

    read.resolve();
    await settle();

    expect(screen.queryByTestId('library-loading')).not.toBeOnTheScreen();
    expect(screen.getByText('Sousou no Frieren')).toBeOnTheScreen();
  });

  it('shows an error with a retry, the spinner while the retry runs, then the library', async () => {
    const retried = createDeferred();
    const repository = createFakeLibraryRepository(LIBRARY);
    repository.beforeCall.mockRejectedValueOnce(READ_FAILURE).mockReturnValueOnce(retried.promise);
    const { user } = await renderLibraryScreen({ repository });
    await settle();

    expect(screen.getByTestId('library-error')).toBeOnTheScreen();
    expect(screen.getByText('Your library could not be loaded')).toBeOnTheScreen();
    expect(screen.queryByText(READ_FAILURE.message)).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByTestId('library-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('library-error')).not.toBeOnTheScreen();

    retried.resolve();
    await settle();

    expect(screen.getByText('Sousou no Frieren')).toBeOnTheScreen();
    expect(repository.list).toHaveBeenCalledTimes(2);
  });

  it('keeps the rows when a later read fails', async () => {
    const queryClient = createQueryClient();
    const repository = createFakeLibraryRepository(LIBRARY);
    await renderLibraryScreen({ repository, queryClient });
    await settle();
    repository.beforeCall.mockRejectedValueOnce(READ_FAILURE);

    await queryClient.refetchQueries();
    await settle();

    expect(repository.list).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Sousou no Frieren')).toBeOnTheScreen();
    expect(screen.queryByTestId('library-error')).not.toBeOnTheScreen();
  });

  it('explains how to add titles to an empty library, and opens Search', async () => {
    const { user } = await renderLibraryScreen({ repository: createFakeLibraryRepository() });
    await settle();

    expect(screen.getByTestId('library-empty')).toBeOnTheScreen();
    expect(screen.getByText('Your library is empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('library-filters-kind')).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Search titles' }));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/search');
  });

  it('says when no title matches, and resets the filters but not the sort', async () => {
    const { user } = await renderLibraryScreen({
      repository: createFakeLibraryRepository([FRIEREN]),
    });
    await settle();
    await user.press(radio('Title'));
    await user.press(radio('Manga'));

    expect(screen.getByTestId('library-list-no-match')).toBeOnTheScreen();
    expect(screen.getByText('No titles match these filters')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Reset filters' }));

    expect(screen.queryByTestId('library-list-no-match')).not.toBeOnTheScreen();
    expect(shownInOrder()).toStrictEqual(['In progress (1)', 'Sousou no Frieren']);
    expect(
      within(screen.getByTestId('library-filters-kind')).getByRole('radio', { name: 'All' }),
    ).toBeChecked();
    expect(radio('Title')).toBeChecked();
  });

  it('shows the headers in french', async () => {
    await renderLibraryScreen({
      repository: createFakeLibraryRepository([FRIEREN, BERSERK]),
      language: 'fr',
    });
    await settle();

    expect(screen.getByRole('header', { name: 'En cours (2)' })).toBeOnTheScreen();
    expect(radio('Dernière modification')).toBeChecked();
  });
});
