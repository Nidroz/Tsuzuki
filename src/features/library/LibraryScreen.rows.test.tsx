import type { MediaDetail } from '@core/catalog/catalog-provider';
import { PROGRESS_WRITE_COALESCE_MS } from '@core/domain/library-progress';
import { queryKeys } from '@core/query/keys';
import { createQueryClient } from '@core/query/query-client';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react-native';
import type { Href } from 'expo-router';

import {
  createFakeLibraryRepository,
  type FakeLibraryRepository,
} from '../../../test/core/fake-library-repository';
import type * as FakeFocusEffect from '../../../test/mobile/fake-focus-effect';
import { renderLibraryScreen, settle } from '../../../test/mobile/render-library-screen';
import {
  ADULT,
  BERSERK,
  FOREIGN_COVER,
  FRIEREN,
  MONSTER,
  MUSHISHI,
} from './__fixtures__/library-entries';
import { libraryEntryTestID } from './LibraryEntryRow';

// fR-14, FR-12, BR-01, BR-06: the rows of the library screen, their `+1` button and their covers

const mockPush = jest.fn<(href: Href) => void>();

// the real module otherwise: the theme provider builds the navigation theme from it. no navigator
// around the screen: focused once mounted
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useFocusEffect: jest.requireActual<typeof FakeFocusEffect>(
    '../../../test/mobile/fake-focus-effect',
  ).useFakeFocusEffect,
  useRouter: () => ({ push: mockPush, navigate: jest.fn() }),
}));

const WRITE_FAILURE = new Error('storage is full');
const FRIEREN_ROW = libraryEntryTestID(FRIEREN.key);
const ADD_EPISODE = 'Add one episode, Sousou no Frieren';

const row = (testID: string) => screen.getByTestId(testID);
const coverOf = (testID: string, part: 'image' | 'placeholder') =>
  screen.queryByTestId(`${testID}-cover-${part}`, { includeHiddenElements: true });

// a repository whose saves fail, its reads still answering
const failingSaves = (): FakeLibraryRepository => {
  const repository = createFakeLibraryRepository([FRIEREN]);
  repository.beforeCall.mockImplementation((method) =>
    method === 'save' ? Promise.reject(WRITE_FAILURE) : Promise.resolve(),
  );
  return repository;
};

describe('LibraryScreen rows', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('names a row by its title, format, progress and score, with an open hint', async () => {
    await renderLibraryScreen();
    await settle();

    expect(row(FRIEREN_ROW)).toHaveAccessibleName(
      'Sousou no Frieren, TV, 12 / 28 episodes, My score 9 / 10',
    );
    expect(row(FRIEREN_ROW)).toHaveProp('accessibilityHint', 'Opens the details');
    // the total unknown and no score
    expect(row(libraryEntryTestID(BERSERK.key))).toHaveAccessibleName(
      'Berserk, Manga, 364 chapters',
    );
    expect(screen.getByRole('button', { name: 'Add one chapter, Berserk' })).toBeEnabled();
  });

  it('opens the detail of a pressed row', async () => {
    const { user } = await renderLibraryScreen();
    await settle();

    await user.press(row(libraryEntryTestID(MONSTER.key)));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/media/[namespace]/[kind]/[id]',
      params: { namespace: 'mal', kind: 'anime', id: '19' },
    });
  });

  it('adds one episode at once and writes it after the taps settle (FR-12, BR-09)', async () => {
    const { user, repository } = await renderLibraryScreen();
    await settle();

    await user.press(screen.getByRole('button', { name: ADD_EPISODE }));
    await user.press(screen.getByRole('button', { name: ADD_EPISODE }));

    expect(row(FRIEREN_ROW)).toHaveAccessibleName(
      'Sousou no Frieren, TV, 14 / 28 episodes, My score 9 / 10',
    );
    expect(repository.save).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();

    await settle(PROGRESS_WRITE_COALESCE_MS);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.stored(FRIEREN.key)).toMatchObject({ progress: 14 });
  });

  it('never refreshes the snapshot from a row `+1`, even with fresher catalog data cached', async () => {
    const queryClient = createQueryClient();
    // the detail of FRIEREN as the catalog now has it: another title, cover and total
    const detail: MediaDetail = {
      key: FRIEREN.key,
      title: 'Frieren',
      titleEnglish: null,
      titleNative: null,
      imageUrl: 'https://cdn.myanimelist.net/images/anime/1015/138006l.webp',
      format: 'tv',
      status: 'finished',
      totalUnits: 30,
      score: null,
      year: 2023,
      genres: [],
      isAdult: false,
      synopsis: null,
    };
    queryClient.setQueryData(queryKeys.media(FRIEREN.key), detail);
    const { user, repository } = await renderLibraryScreen({ queryClient });
    await settle();

    await user.press(screen.getByRole('button', { name: ADD_EPISODE }));
    await settle(PROGRESS_WRITE_COALESCE_MS);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.stored(FRIEREN.key)).toMatchObject({ progress: 13 });
    expect(repository.stored(FRIEREN.key)?.media).toStrictEqual(FRIEREN.media);
    expect(row(FRIEREN_ROW)).toHaveAccessibleName(
      'Sousou no Frieren, TV, 13 / 28 episodes, My score 9 / 10',
    );
  });

  it('disables `+1` at the known total (BR-01)', async () => {
    await renderLibraryScreen();
    await settle();

    expect(screen.getByRole('button', { name: 'Add one episode, Mushishi' })).toBeDisabled();
    expect(row(libraryEntryTestID(MUSHISHI.key))).toBeEnabled();
  });

  it('shows a failed `+1` under its row until it is dismissed', async () => {
    const { user } = await renderLibraryScreen({ repository: failingSaves() });
    await settle();

    await user.press(screen.getByRole('button', { name: ADD_EPISODE }));
    await settle(PROGRESS_WRITE_COALESCE_MS);
    const error = screen.getByTestId(`${FRIEREN_ROW}-error`);
    expect(error).toHaveTextContent('Your change could not be saved.', { exact: false });
    expect(screen.queryByText(WRITE_FAILURE.message)).not.toBeOnTheScreen();
    // the failure refetches the stored truth
    await waitFor(() => {
      expect(row(FRIEREN_ROW)).toHaveAccessibleName(
        'Sousou no Frieren, TV, 12 / 28 episodes, My score 9 / 10',
      );
    });

    await user.press(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId(`${FRIEREN_ROW}-error`)).not.toBeOnTheScreen();
  });

  it('hides the adult entries and says how many are hidden (BR-06)', async () => {
    await renderLibraryScreen({ repository: createFakeLibraryRepository([FRIEREN, ADULT]) });
    await settle();

    expect(screen.getByTestId('library-list-hidden-note')).toHaveTextContent(
      '1 adult title is hidden.',
    );
    expect(screen.queryByText(ADULT.media.title)).not.toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'In progress (1)' })).toBeOnTheScreen();
  });

  it('shows the adult entries while the setting is on (BR-06)', async () => {
    await renderLibraryScreen({
      repository: createFakeLibraryRepository([FRIEREN, ADULT]),
      showAdult: true,
    });
    await settle();

    expect(screen.getByText(ADULT.media.title)).toBeOnTheScreen();
    expect(screen.queryByTestId('library-list-hidden-note')).not.toBeOnTheScreen();
  });

  it('keeps the note without a reset when only adult entries are hidden', async () => {
    await renderLibraryScreen({ repository: createFakeLibraryRepository([ADULT]) });
    await settle();

    expect(screen.getByTestId('library-list-no-match')).toBeOnTheScreen();
    expect(screen.getByTestId('library-list-hidden-note')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeOnTheScreen();
  });

  it("shows a cover on the provider's hosts, and the placeholder for any other host", async () => {
    const foreign = { ...FRIEREN, media: { ...FRIEREN.media, imageUrl: FOREIGN_COVER } };
    await renderLibraryScreen({ repository: createFakeLibraryRepository([foreign, BERSERK]) });
    await settle();

    expect(coverOf(FRIEREN_ROW, 'placeholder')).toBeTruthy();
    expect(coverOf(FRIEREN_ROW, 'image')).toBeNull();
    expect(coverOf(libraryEntryTestID(BERSERK.key), 'image')?.props.source).toStrictEqual([
      { uri: BERSERK.media.imageUrl },
    ]);
  });
});
