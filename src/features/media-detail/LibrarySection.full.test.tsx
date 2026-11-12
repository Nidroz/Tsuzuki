import { LIBRARY_ENTRIES_PER_USER_MAX } from '@core/domain/database-limits';
import { LibraryRemoteError } from '@core/errors/library-errors';
import type { GuestMergeFailure, GuestMergeValue } from '@core/hooks/guest-merge-context';
import { LibraryContextProvider } from '@core/hooks/LibraryContextProvider';
import { PENDING_LIBRARY_REPOSITORY } from '@core/hooks/SessionLibraryContextProvider';
import { formatNumber, type Language } from '@core/i18n/index';
import { describe, expect, it, jest } from '@jest/globals';
import { act, screen, userEvent } from '@testing-library/react-native';

import { createFakeLibraryRepository } from '../../../test/core/fake-library-repository';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { FRIEREN_DETAIL } from './__fixtures__/media-details';
import { LibrarySection } from './LibrarySection';

// per R-04, the account library full (LIBRARY_ENTRIES_PER_USER_MAX entries) told by the detail's
// library section, for a refused Add and for a guest merge refused at the cap

const TEST_ID = 'media-detail-library';
const ADD = 'Add to library';
const WRITE_ERROR = 'Your change could not be saved.';
const WRITE_FULL = 'Your library is full: it holds 10,000 titles. Remove titles to add new ones.';
const MERGE_FAILED =
  'The titles saved on this device could not be added to your account. They stay on this device: try again to add them and open your library.';
const MERGE_FULL =
  'The titles saved on this device could not be added to your account: its library is full, with 10,000 titles. They stay on this device. Remove titles from your library on another device, then try again, or sign out to use them here.';

const FR_MAX = formatNumber(LIBRARY_ENTRIES_PER_USER_MAX, 'fr');

const settle = async () => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
};

// the section over a library whose next save rejects with `failure`, then an Add
const addRefusedWith = async (failure: Error, language: Language = 'en') => {
  const repository = createFakeLibraryRepository();
  repository.beforeCall.mockImplementation((method) =>
    method === 'save' ? Promise.reject(failure) : Promise.resolve(),
  );
  await renderWithProviders(
    <LibraryContextProvider repository={repository}>
      <LibrarySection mediaKey={FRIEREN_DETAIL.key} media={FRIEREN_DETAIL} />
    </LibraryContextProvider>,
    { language },
  );
  const user = userEvent.setup();
  await user.press(await screen.findByTestId(`${TEST_ID}-add`));
  await settle();
  return { repository, user };
};

// the section after a failed guest merge, the library pending as the session library gives it
const renderMergeFailed = async (failure: GuestMergeFailure, language: Language = 'en') => {
  const retry = jest.fn<() => void>();
  const guestMerge: GuestMergeValue = { status: 'failed', failure, retry };
  await renderWithProviders(
    <LibraryContextProvider repository={PENDING_LIBRARY_REPOSITORY}>
      <LibrarySection mediaKey={FRIEREN_DETAIL.key} media={FRIEREN_DETAIL} />
    </LibraryContextProvider>,
    { guestMerge, language },
  );
  await settle();
  return { retry, user: userEvent.setup() };
};

describe('LibrarySection with a full account library (R-04)', () => {
  it('says the library is full, with its cap, when an Add is refused for it', async () => {
    const { user } = await addRefusedWith(new LibraryRemoteError('library-full'));

    const error = screen.getByTestId(`${TEST_ID}-write-error`);
    expect(error).toHaveTextContent(WRITE_FULL, { exact: false });
    expect(screen.queryByText(WRITE_ERROR)).not.toBeOnTheScreen();
    // the stored truth again: still outside the library
    expect(screen.getByRole('button', { name: ADD })).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId(`${TEST_ID}-write-error`)).not.toBeOnTheScreen();
  });

  it('keeps the generic message for any other refused write', async () => {
    await addRefusedWith(new LibraryRemoteError('rejected'));

    expect(screen.getByTestId(`${TEST_ID}-write-error`)).toHaveTextContent(WRITE_ERROR, {
      exact: false,
    });
    expect(screen.queryByText(WRITE_FULL)).not.toBeOnTheScreen();
  });

  it('says the library is full in french', async () => {
    await addRefusedWith(new LibraryRemoteError('library-full'), 'fr');

    expect(screen.getByTestId(`${TEST_ID}-write-error`)).toHaveTextContent(
      `Votre bibliothèque est pleine : elle contient ${FR_MAX} titres. Retirez des titres pour en ajouter de nouveaux.`,
      { exact: false },
    );
  });

  it('tells a guest merge refused by a full account library, with Try again', async () => {
    const { retry, user } = await renderMergeFailed('library-full');

    const failure = screen.getByTestId(`${TEST_ID}-merge-error`);
    expect(failure).toHaveTextContent(MERGE_FULL, { exact: false });
    expect(screen.queryByText(MERGE_FAILED)).not.toBeOnTheScreen();

    await user.press(screen.getByTestId(`${TEST_ID}-merge-error-action`));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps the generic merge failure for any other failure', async () => {
    await renderMergeFailed('other');

    expect(screen.getByTestId(`${TEST_ID}-merge-error`)).toHaveTextContent(MERGE_FAILED, {
      exact: false,
    });
  });

  it('tells a guest merge refused by a full account library in french', async () => {
    await renderMergeFailed('library-full', 'fr');

    expect(screen.getByTestId(`${TEST_ID}-merge-error`)).toHaveTextContent(
      `Les titres enregistrés sur cet appareil n'ont pas pu être ajoutés à votre compte : sa bibliothèque est pleine, avec ${FR_MAX} titres. Ils restent sur cet appareil. Retirez des titres de votre bibliothèque sur un autre appareil, puis réessayez, ou déconnectez-vous pour les utiliser ici.`,
      { exact: false },
    );
    expect(screen.getByTestId(`${TEST_ID}-merge-error-action`)).toHaveAccessibleName('Réessayer');
  });
});
