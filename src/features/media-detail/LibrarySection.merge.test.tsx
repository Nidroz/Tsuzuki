import type { GuestMergeStatus, GuestMergeValue } from '@core/hooks/guest-merge-context';
import { LibraryContextProvider } from '@core/hooks/LibraryContextProvider';
import { PENDING_LIBRARY_REPOSITORY } from '@core/hooks/SessionLibraryContextProvider';
import type { Language } from '@core/i18n/index';
import type { LibraryRepository } from '@core/repositories/library-repository';
import { describe, expect, it, jest } from '@jest/globals';
import { act, screen, userEvent } from '@testing-library/react-native';

import { createFakeLibraryRepository } from '../../../test/core/fake-library-repository';
import { entryOf } from '../../../test/core/library-entry-fixtures';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { FRIEREN_DETAIL } from './__fixtures__/media-details';
import { LibrarySection } from './LibrarySection';

// see ADR-0016 "What the user sees": the detail's library section while the guest library is merged
// into the account, and after a failed merge. the library stays pending until a merge succeeded
// (SessionLibraryContextProvider): no Add, no favorite toggle, no endless spinner

const TEST_ID = 'media-detail-library';
const MERGING_TEXT = 'Adding the titles saved on this device to your account…';
const FAILED_TEXT =
  'The titles saved on this device could not be added to your account. They stay on this device: try again to add them and open your library.';
const LOADING = 'Loading your library';

interface SectionSetup {
  readonly status: GuestMergeStatus;
  /** the pending library by default, as the session library gives it then */
  readonly repository?: LibraryRepository;
  readonly language?: Language;
}

const renderSection = async ({
  status,
  repository = PENDING_LIBRARY_REPOSITORY,
  language = 'en',
}: SectionSetup) => {
  const retry = jest.fn<() => void>();
  const guestMerge: GuestMergeValue = { status, retry };
  await renderWithProviders(
    <LibraryContextProvider repository={repository}>
      <LibrarySection mediaKey={FRIEREN_DETAIL.key} media={FRIEREN_DETAIL} />
    </LibraryContextProvider>,
    { guestMerge, language },
  );
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
  return { retry, user: userEvent.setup() };
};

// neither an action on the media nor the panel of an entry
const expectNoLibraryAction = () => {
  expect(screen.queryByTestId(`${TEST_ID}-add`)).not.toBeOnTheScreen();
  expect(screen.queryByTestId(`${TEST_ID}-favorite`)).not.toBeOnTheScreen();
  expect(screen.queryByTestId(`${TEST_ID}-status`)).not.toBeOnTheScreen();
};

describe('LibrarySection guest merge (A-04)', () => {
  it('says the titles of the device are being added with a spinner read once, without any action', async () => {
    await renderSection({ status: 'merging' });

    const spinner = screen.getByRole('progressbar', { name: MERGING_TEXT });
    expect(spinner).toHaveProp('testID', `${TEST_ID}-merging`);
    // the visible caption is hidden from screen readers: the sentence is read once
    expect(screen.getByText(MERGING_TEXT, { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText(MERGING_TEXT)).not.toBeOnTheScreen();
    expect(screen.getAllByLabelText(MERGING_TEXT)).toStrictEqual([spinner]);
    expect(screen.queryByLabelText(LOADING)).not.toBeOnTheScreen();
    expectNoLibraryAction();
  });

  it('shows a failed merge with Try again instead of the endless spinner, without any action', async () => {
    const { retry, user } = await renderSection({ status: 'failed' });

    const failure = screen.getByTestId(`${TEST_ID}-merge-error`);
    expect(failure).toHaveProp('accessibilityRole', 'alert');
    expect(failure).toHaveTextContent(FAILED_TEXT, { exact: false });
    expect(screen.queryByLabelText(LOADING)).not.toBeOnTheScreen();
    expectNoLibraryAction();

    const action = screen.getByTestId(`${TEST_ID}-merge-error-action`);
    expect(action).toHaveAccessibleName('Try again');
    await user.press(action);

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it.each<GuestMergeStatus>(['merging', 'failed'])(
    'offers no action while %s even over a library that answers',
    async (status) => {
      const repository = createFakeLibraryRepository([entryOf()]);

      await renderSection({ status, repository });

      expectNoLibraryAction();
      expect(repository.save).not.toHaveBeenCalled();
    },
  );

  it('shows the loading spinner while the guest store is checked', async () => {
    await renderSection({ status: 'checking' });

    expect(screen.getByLabelText(LOADING)).toHaveProp('testID', `${TEST_ID}-loading`);
    expect(screen.queryByTestId(`${TEST_ID}-merging`)).not.toBeOnTheScreen();
    expect(screen.queryByTestId(`${TEST_ID}-merge-error`)).not.toBeOnTheScreen();
    expectNoLibraryAction();
  });

  it('shows the failed merge in french', async () => {
    await renderSection({ status: 'failed', language: 'fr' });

    expect(screen.getByTestId(`${TEST_ID}-merge-error`)).toHaveTextContent(
      "Les titres enregistrés sur cet appareil n'ont pas pu être ajoutés à votre compte.",
      { exact: false },
    );
    expect(screen.getByTestId(`${TEST_ID}-merge-error-action`)).toHaveAccessibleName('Réessayer');
  });
});
