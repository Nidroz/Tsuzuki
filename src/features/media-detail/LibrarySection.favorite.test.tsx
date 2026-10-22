import type { MediaDetail } from '@core/catalog/catalog-provider';
import type { LibraryEntry } from '@core/domain/library-entry';
import { LibraryContextProvider } from '@core/hooks/LibraryContextProvider';
import { describe, expect, it, jest } from '@jest/globals';
import { act, screen, userEvent } from '@testing-library/react-native';

import {
  createDeferred,
  createFakeLibraryRepository,
} from '../../../test/core/fake-library-repository';
import { entryOf } from '../../../test/core/library-entry-fixtures';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { FRIEREN_DETAIL } from './__fixtures__/media-details';
import { LibrarySection } from './LibrarySection';

// fR-15, BR-05: the favorite toggle of the detail's library section, and a media no snapshot can
// hold

const TEST_ID = 'media-detail-library';
const FAVORITE_ID = `${TEST_ID}-favorite`;
const ADD = 'Add to library';
const ADD_FAVORITE = 'Add to favorites';
const REMOVE_FAVORITE = 'Remove from favorites';
const UNSUPPORTED = 'This title cannot be saved to your library.';
const READ_FAILURE = new Error('storage is unreadable');

// an entry of FRIEREN_DETAIL (the fixtures' ENTRY_KEY): current, at 12 of 28 episodes
const ENTRY = entryOf();
// a detail no snapshot can hold: a title is at least one character (the database limits)
const UNSTORABLE_DETAIL: MediaDetail = { ...FRIEREN_DETAIL, title: '' };

const renderSection = async (
  initial: readonly LibraryEntry[] = [],
  media: MediaDetail = FRIEREN_DETAIL,
) => {
  const repository = createFakeLibraryRepository(initial);
  await renderWithProviders(
    <LibraryContextProvider repository={repository}>
      <LibrarySection mediaKey={media.key} media={media} />
    </LibraryContextProvider>,
  );
  return { repository, user: userEvent.setup() };
};

// lets the pending repository calls and writes settle
const settle = async () => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
};

const favorite = () => screen.getByTestId(FAVORITE_ID);

describe('LibrarySection favorite (FR-15)', () => {
  it('adds a media outside the library as a planned favorite (BR-05)', async () => {
    const { repository, user } = await renderSection();
    await screen.findByRole('button', { name: ADD });

    expect(favorite()).toHaveAccessibleName(ADD_FAVORITE);
    expect(favorite()).not.toBeSelected();

    await user.press(favorite());
    await settle();

    expect(repository.stored(FRIEREN_DETAIL.key)).toMatchObject({
      status: 'planned',
      progress: 0,
      isFavorite: true,
      media: { title: FRIEREN_DETAIL.title, totalUnits: FRIEREN_DETAIL.totalUnits },
    });
    expect(screen.queryByRole('button', { name: ADD })).not.toBeOnTheScreen();
    expect(screen.getByTestId(`${TEST_ID}-status`)).toHaveAccessibleName(
      'My status, Plan to watch',
    );
    expect(favorite()).toHaveAccessibleName(REMOVE_FAVORITE);
    expect(favorite()).toBeSelected();
  });

  it('unfavorites an entry and keeps it in the library', async () => {
    const { repository, user } = await renderSection([entryOf({ isFavorite: true })]);
    await screen.findByTestId(`${TEST_ID}-status`);

    expect(screen.getByRole('button', { name: REMOVE_FAVORITE })).toBeSelected();

    await user.press(favorite());
    await settle();

    expect(repository.stored(FRIEREN_DETAIL.key)).toMatchObject({
      isFavorite: false,
      status: ENTRY.status,
      progress: ENTRY.progress,
    });
    expect(favorite()).toHaveAccessibleName(ADD_FAVORITE);
    expect(favorite()).not.toBeSelected();
    expect(screen.getByTestId(`${TEST_ID}-status`)).toBeOnTheScreen();
  });

  it('hides the toggle while the entry loads and when it cannot be read', async () => {
    const read = createDeferred();
    const repository = createFakeLibraryRepository();
    repository.beforeCall.mockReturnValueOnce(read.promise).mockRejectedValueOnce(READ_FAILURE);
    await renderWithProviders(
      <LibraryContextProvider repository={repository}>
        <LibrarySection mediaKey={FRIEREN_DETAIL.key} media={FRIEREN_DETAIL} />
      </LibraryContextProvider>,
    );

    expect(screen.getByTestId(`${TEST_ID}-loading`)).toBeOnTheScreen();
    expect(screen.queryByTestId(FAVORITE_ID)).not.toBeOnTheScreen();

    read.reject(READ_FAILURE);

    expect(await screen.findByTestId(`${TEST_ID}-read-error`)).toBeOnTheScreen();
    expect(screen.queryByTestId(FAVORITE_ID)).not.toBeOnTheScreen();
  });

  it.each<[string, readonly LibraryEntry[]]>([
    ['in the library', [ENTRY]],
    ['outside the library', []],
  ])(
    'says a media no snapshot can hold cannot be saved, without a retry, add or heart (%s)',
    async (_where, initial) => {
      const { repository } = await renderSection(initial, UNSTORABLE_DETAIL);

      const unsupported = await screen.findByTestId(`${TEST_ID}-unsupported`);

      expect(unsupported).toHaveTextContent(UNSUPPORTED, { exact: false });
      expect(unsupported).toHaveProp('accessibilityRole', 'alert');
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeOnTheScreen();
      expect(screen.queryByTestId(`${TEST_ID}-read-error`)).not.toBeOnTheScreen();
      expect(screen.queryByTestId(`${TEST_ID}-add`)).not.toBeOnTheScreen();
      expect(screen.queryByTestId(FAVORITE_ID)).not.toBeOnTheScreen();
      expect(repository.save).not.toHaveBeenCalled();
    },
  );

  it('names the toggle in french', async () => {
    const repository = createFakeLibraryRepository([entryOf({ isFavorite: true })]);
    await renderWithProviders(
      <LibraryContextProvider repository={repository}>
        <LibrarySection mediaKey={FRIEREN_DETAIL.key} media={FRIEREN_DETAIL} />
      </LibraryContextProvider>,
      { language: 'fr' },
    );

    expect(await screen.findByRole('button', { name: 'Retirer des favoris' })).toBeSelected();
  });
});
