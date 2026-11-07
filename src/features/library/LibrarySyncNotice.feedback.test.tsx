import type { ErrorReporter } from '@core/errors/error-reporter';
import type { Language } from '@core/i18n/index';
import { describe, expect, it, jest } from '@jest/globals';
import { act, screen, userEvent, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { createFakeGuestLibraryRepository } from '../../../test/core/fake-library-repository';
import { createStuckAccount, type StuckAccount } from '../../../test/core/stuck-account';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { LibrarySyncNotice } from './LibrarySyncNotice';

// per R-03: the notice of the stuck writes says what its last action could not do, announced: a
// Try again while offline, a Discard whose storage failed

const TEST_ID = 'library-sync';
const FEEDBACK_ID = `${TEST_ID}-feedback`;
const OFFLINE = 'You are offline. Connect to the internet, then try again.';
const DISCARD_FAILED = 'The changes could not be discarded. Try again.';
const DISCARD_LABEL = 'Discard the changes that could not be synced';

// the react native jest preset mocks announceForAccessibility: its calls survive restoreMocks
const spyOnAnnounce = () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  announce.mockClear();
  return announce;
};

const settle = async () => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
};

const failingDiscard = () => {
  throw new Error('storage failed');
};

// the notice of `stuck`'s account, the live library of the tree, with a recording reporter
const renderNotice = async (stuck: StuckAccount, language: Language = 'en') => {
  const captureError = jest.fn<ErrorReporter['captureError']>();
  await renderWithProviders(<LibrarySyncNotice testID={TEST_ID} />, {
    language,
    sessionLibrary: { account: stuck.account, guest: createFakeGuestLibraryRepository() },
    reporter: { captureError },
  });
  return { user: userEvent.setup(), captureError };
};

const discardConfirmed = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.press(screen.getByRole('button', { name: DISCARD_LABEL }));
  const sheet = screen.getByTestId(`${TEST_ID}-discard-sheet`);
  await user.press(within(sheet).getByTestId(`${TEST_ID}-discard-sheet-confirm`));
};

describe('LibrarySyncNotice feedback', () => {
  it('shows none until an action could not happen', async () => {
    await renderNotice(createStuckAccount(1));

    expect(screen.queryByTestId(FEEDBACK_ID)).not.toBeOnTheScreen();
  });

  it('says the device is offline after a Try again that found it offline, as an announced alert', async () => {
    const stuck = createStuckAccount(1);
    stuck.account.retryStuckWrites.mockResolvedValueOnce({ status: 'offline', confirmed: 0 });
    const { user } = await renderNotice(stuck);
    const announce = spyOnAnnounce();

    await user.press(screen.getByRole('button', { name: 'Try again' }));
    await settle();

    const feedback = screen.getByTestId(FEEDBACK_ID);
    expect(feedback).toHaveProp('accessibilityRole', 'alert');
    expect(feedback).toHaveTextContent(OFFLINE);
    expect(announce.mock.calls).toStrictEqual([[OFFLINE]]);
    // the notice itself stays, with its actions
    expect(screen.getByTestId(`${TEST_ID}-retry`)).toBeEnabled();
  });

  it('clears the feedback when the next Try again starts', async () => {
    const stuck = createStuckAccount(1);
    stuck.account.retryStuckWrites
      .mockResolvedValueOnce({ status: 'offline', confirmed: 0 })
      .mockReturnValueOnce(new Promise(() => undefined));
    const { user } = await renderNotice(stuck);
    await user.press(screen.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(screen.getByTestId(FEEDBACK_ID)).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.queryByTestId(FEEDBACK_ID)).not.toBeOnTheScreen();
  });

  it('says the changes were not discarded when the storage failed, announced, and reports it', async () => {
    const stuck = createStuckAccount(2);
    stuck.account.discardStuckWrites.mockImplementationOnce(failingDiscard);
    const { user, captureError } = await renderNotice(stuck);
    const announce = spyOnAnnounce();

    await discardConfirmed(user);

    const feedback = screen.getByTestId(FEEDBACK_ID);
    expect(feedback).toHaveProp('accessibilityRole', 'alert');
    expect(feedback).toHaveTextContent(DISCARD_FAILED);
    expect(announce.mock.calls).toStrictEqual([[DISCARD_FAILED]]);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(`${TEST_ID}-discard-sheet`)).not.toBeOnTheScreen();
    expect(screen.getByTestId(`${TEST_ID}-message`)).toBeOnTheScreen();
  });

  it('clears a failed discard when the next discard starts, and goes with the last stuck write', async () => {
    const stuck = createStuckAccount(2);
    stuck.account.discardStuckWrites.mockImplementationOnce(failingDiscard);
    const { user } = await renderNotice(stuck);
    await discardConfirmed(user);
    expect(screen.getByTestId(FEEDBACK_ID)).toBeOnTheScreen();

    await discardConfirmed(user);

    expect(screen.queryByTestId(FEEDBACK_ID)).not.toBeOnTheScreen();

    stuck.account.discardStuckWrites.mockImplementationOnce(failingDiscard);
    await discardConfirmed(user);
    await act(() => {
      stuck.setStuckCount(0);
    });
    await act(() => {
      stuck.setStuckCount(1);
    });

    expect(screen.getByTestId(`${TEST_ID}-message`)).toBeOnTheScreen();
    expect(screen.queryByTestId(FEEDBACK_ID)).not.toBeOnTheScreen();
  });

  it('says the device is offline in french', async () => {
    const stuck = createStuckAccount(1);
    stuck.account.retryStuckWrites.mockResolvedValueOnce({ status: 'offline', confirmed: 0 });
    const { user } = await renderNotice(stuck, 'fr');

    await user.press(screen.getByRole('button', { name: 'Réessayer' }));
    await settle();

    expect(screen.getByTestId(FEEDBACK_ID)).toHaveTextContent(
      'Vous êtes hors ligne. Connectez-vous à Internet, puis réessayez.',
    );
  });

  it('says a failed discard in french', async () => {
    const stuck = createStuckAccount(1);
    stuck.account.discardStuckWrites.mockImplementationOnce(failingDiscard);
    const { user } = await renderNotice(stuck, 'fr');

    await user.press(
      screen.getByRole('button', {
        name: "Abandonner les modifications qui n'ont pas pu être synchronisées",
      }),
    );
    await user.press(screen.getByTestId(`${TEST_ID}-discard-sheet-confirm`));

    expect(screen.getByTestId(FEEDBACK_ID)).toHaveTextContent(
      "Les modifications n'ont pas pu être abandonnées. Réessayez.",
    );
  });
});
