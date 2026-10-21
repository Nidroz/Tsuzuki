import type { MediaDetail } from '@core/catalog/catalog-provider';
import type { LibraryEntry } from '@core/domain/library-entry';
import { PROGRESS_WRITE_COALESCE_MS } from '@core/domain/library-progress';
import { LibraryContextProvider } from '@core/hooks/LibraryContextProvider';
import { describe, expect, it, jest } from '@jest/globals';
import { act, screen, userEvent } from '@testing-library/react-native';

import {
  createDeferred,
  createFakeLibraryRepository,
} from '../../../test/core/fake-library-repository';
import { entryOf, entryWithMedia } from '../../../test/core/library-entry-fixtures';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { FRIEREN_DETAIL } from './__fixtures__/media-details';
import { LibrarySection } from './LibrarySection';

const TEST_ID = 'media-detail-library';
const LOADING = 'Loading your library';
const ADD = 'Add to library';
const READ_ERROR = 'Your library could not be read.';
const WRITE_ERROR = 'Your change could not be saved.';
// the raw error of the repository: never shown
const STORAGE_FAILURE = new Error('storage is full');

// an entry of FRIEREN_DETAIL (the fixtures' ENTRY_KEY): current, at 12 of 28 episodes
const ENTRY = entryOf();

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
const settle = async (ms = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

const button = (name: string) => screen.getByRole('button', { name });

describe('LibrarySection', () => {
  it('shows a labelled spinner while the entry loads, then Add for a media outside the library', async () => {
    const read = createDeferred();
    const repository = createFakeLibraryRepository();
    repository.beforeCall.mockReturnValueOnce(read.promise);
    await renderWithProviders(
      <LibraryContextProvider repository={repository}>
        <LibrarySection mediaKey={FRIEREN_DETAIL.key} media={FRIEREN_DETAIL} />
      </LibraryContextProvider>,
    );

    expect(screen.getByRole('header', { name: 'My library' })).toBeOnTheScreen();
    expect(screen.getByLabelText(LOADING)).toHaveProp('testID', `${TEST_ID}-loading`);

    read.resolve();

    expect(await screen.findByRole('button', { name: ADD })).toBeOnTheScreen();
    expect(screen.queryByTestId(`${TEST_ID}-loading`)).not.toBeOnTheScreen();
    expect(repository.get).toHaveBeenCalledWith(FRIEREN_DETAIL.key);
  });

  it('only reads the library on view: no write', async () => {
    const { repository } = await renderSection([ENTRY]);

    expect(await screen.findByTestId(`${TEST_ID}-status`)).toBeOnTheScreen();
    await settle(PROGRESS_WRITE_COALESCE_MS);

    expect(repository.get).toHaveBeenCalledTimes(1);
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('shows the fresh snapshot of a stale entry without writing it until a tap (ADR-0009)', async () => {
    // stored with an older title, cover, format and total than the catalog's
    const stale = entryWithMedia({
      title: 'Frieren',
      imageUrl: 'https://cdn.myanimelist.net/images/anime/1/1.jpg',
      format: 'ona',
      totalUnits: 24,
    });
    const { repository, user } = await renderSection([stale]);

    expect(await screen.findByTestId(`${TEST_ID}-progress`)).toHaveAccessibleName(
      'Progress, 12 / 28 episodes',
    );
    await settle(PROGRESS_WRITE_COALESCE_MS * 2);

    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.stored(FRIEREN_DETAIL.key)).toBe(stale);

    await user.press(button('Edit my score'));
    await user.press(screen.getByRole('radio', { name: '8 / 10' }));
    await user.press(button('Save'));
    await settle();

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.stored(FRIEREN_DETAIL.key)).toMatchObject({
      score: 8,
      media: {
        title: FRIEREN_DETAIL.title,
        imageUrl: FRIEREN_DETAIL.imageUrl,
        format: FRIEREN_DETAIL.format,
        totalUnits: FRIEREN_DETAIL.totalUnits,
      },
    });
  });

  it('adds the media as a planned entry with its snapshot on Add (FR-10)', async () => {
    const { repository, user } = await renderSection();

    await user.press(await screen.findByRole('button', { name: ADD }));
    await settle();

    expect(repository.stored(FRIEREN_DETAIL.key)).toMatchObject({
      status: 'planned',
      progress: 0,
      media: { title: FRIEREN_DETAIL.title, totalUnits: FRIEREN_DETAIL.totalUnits },
    });
    expect(screen.getByTestId(`${TEST_ID}-status`)).toHaveAccessibleName(
      'My status, Plan to watch',
    );
    expect(screen.queryByRole('button', { name: ADD })).not.toBeOnTheScreen();
  });

  it('shows the entry with the fresh catalog total, and writes rapid +1 taps once', async () => {
    // stored while the total was unknown: the detail's total of 28 applies
    const { repository, user } = await renderSection([entryWithMedia({ totalUnits: null })]);
    const progress = await screen.findByTestId(`${TEST_ID}-progress`);

    expect(progress).toHaveAccessibleName('Progress, 12 / 28 episodes');

    await user.press(button('Add one episode'));
    await user.press(button('Add one episode'));

    expect(screen.getByTestId(`${TEST_ID}-progress`)).toHaveAccessibleName(
      'Progress, 14 / 28 episodes',
    );

    await settle(PROGRESS_WRITE_COALESCE_MS);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.stored(FRIEREN_DETAIL.key)).toMatchObject({
      progress: 14,
      media: { totalUnits: FRIEREN_DETAIL.totalUnits },
    });
  });

  it('removes the entry after the confirmation, back to Add', async () => {
    const { repository, user } = await renderSection([ENTRY]);

    await user.press(await screen.findByRole('button', { name: 'Remove from library' }));
    await user.press(button('Remove'));
    await settle();

    expect(repository.stored(FRIEREN_DETAIL.key)).toBeNull();
    expect(button(ADD)).toBeOnTheScreen();
  });

  it('shows a translated read error with a retry that reads again', async () => {
    const repository = createFakeLibraryRepository();
    repository.beforeCall.mockRejectedValueOnce(STORAGE_FAILURE);
    const user = userEvent.setup();
    await renderWithProviders(
      <LibraryContextProvider repository={repository}>
        <LibrarySection mediaKey={FRIEREN_DETAIL.key} media={FRIEREN_DETAIL} />
      </LibraryContextProvider>,
    );

    expect(await screen.findByText(READ_ERROR)).toBeOnTheScreen();
    expect(screen.getByTestId(`${TEST_ID}-read-error`)).toHaveProp('accessibilityRole', 'alert');
    expect(screen.queryByText(STORAGE_FAILURE.message)).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: ADD })).not.toBeOnTheScreen();

    await user.press(button('Try again'));

    expect(await screen.findByRole('button', { name: ADD })).toBeOnTheScreen();
    expect(screen.queryByText(READ_ERROR)).not.toBeOnTheScreen();
    expect(repository.get).toHaveBeenCalledTimes(2);
  });

  it('shows a dismissible translated message when a write fails, never the raw error', async () => {
    const { repository, user } = await renderSection();
    await user.press(await screen.findByRole('button', { name: ADD }));
    // the add above went through: the next save fails
    await settle();
    repository.beforeCall.mockRejectedValueOnce(STORAGE_FAILURE);

    await user.press(button('Edit my score'));
    await user.press(screen.getByRole('radio', { name: '8 / 10' }));
    await user.press(button('Save'));
    await settle();

    expect(screen.getByTestId(`${TEST_ID}-write-error`)).toHaveTextContent(WRITE_ERROR, {
      exact: false,
    });
    expect(screen.queryByText(STORAGE_FAILURE.message)).not.toBeOnTheScreen();
    // the stored truth is shown again
    expect(screen.getByTestId(`${TEST_ID}-score`)).toHaveAccessibleName('My score, No score');

    await user.press(button('Dismiss'));

    expect(screen.queryByTestId(`${TEST_ID}-write-error`)).not.toBeOnTheScreen();
  });
});
