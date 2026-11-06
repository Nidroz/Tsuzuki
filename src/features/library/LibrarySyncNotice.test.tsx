import type { Language } from '@core/i18n/index';
import type { LibraryReplayRun } from '@core/repositories/offline-account-library-repository';
import { describe, expect, it, jest } from '@jest/globals';
import { act, screen, userEvent, within } from '@testing-library/react-native';

import {
  createDeferred,
  createFakeGuestLibraryRepository,
} from '../../../test/core/fake-library-repository';
import { createStuckAccount, type StuckAccount } from '../../../test/core/stuck-account';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { LibrarySyncNotice } from './LibrarySyncNotice';

// per ADR-0017 "Stuck writes", visible state: the notice of the changes that could not be synced,
// its Try again and its Discard confirmation

const TEST_ID = 'library-sync';
const SHEET_TEST_ID = `${TEST_ID}-discard-sheet`;

const noticeText = (count: number): string =>
  count === 1
    ? '1 change could not be synced to your account.'
    : `${String(count)} changes could not be synced to your account.`;

const sheetText = (count: number): string =>
  count === 1
    ? '1 change made on this device could not be synced. Discarding it replaces it with the version saved in your account, if there is one.'
    : `${String(count)} changes made on this device could not be synced. Discarding them replaces them with the version saved in your account, if there is one.`;

const DISCARD_LABEL = 'Discard the changes that could not be synced';
const RETRYING_LABEL = 'Trying to sync your changes again';

// the notice of `stuck`'s account, the live library of the tree
const renderNotice = async (stuck: StuckAccount, language: Language = 'en') => {
  await renderWithProviders(<LibrarySyncNotice testID={TEST_ID} />, {
    language,
    sessionLibrary: { account: stuck.account, guest: createFakeGuestLibraryRepository() },
  });
  return userEvent.setup();
};

const setStuckCount = async (stuck: StuckAccount, count: number) => {
  await act(() => {
    stuck.setStuckCount(count);
  });
};

const openDiscardSheet = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.press(screen.getByRole('button', { name: DISCARD_LABEL }));
  return screen.getByTestId(SHEET_TEST_ID);
};

describe('LibrarySyncNotice', () => {
  it('renders nothing without a stuck write', async () => {
    await renderNotice(createStuckAccount(0));

    expect(screen.queryByTestId(TEST_ID)).not.toBeOnTheScreen();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  });

  it.each([1, 3])(
    'says how many changes could not be synced (%i), as an alert named by its message',
    async (count) => {
      await renderNotice(createStuckAccount(count));

      const alert = screen.getByRole('alert', { name: noticeText(count) });
      expect(alert).toHaveTextContent(noticeText(count), { exact: true });
      expect(within(screen.getByTestId(TEST_ID)).getByRole('button', { name: 'Try again' })).toBe(
        screen.getByTestId(`${TEST_ID}-retry`),
      );
      expect(screen.getByRole('button', { name: DISCARD_LABEL })).toBe(
        screen.getByTestId(`${TEST_ID}-discard`),
      );
    },
  );

  it.each([
    [
      1,
      "1 modification n'a pas pu être synchronisée avec votre compte.",
      "1 modification faite sur cet appareil n'a pas pu être synchronisée. Si vous l'abandonnez, elle sera remplacée par la version enregistrée dans votre compte, s'il y en a une.",
    ],
    [
      2,
      "2 modifications n'ont pas pu être synchronisées avec votre compte.",
      "2 modifications faites sur cet appareil n'ont pas pu être synchronisées. Si vous les abandonnez, elles seront remplacées par la version enregistrée dans votre compte, s'il y en a une.",
    ],
  ])('says it in french (%i)', async (count, text, sheet) => {
    const user = await renderNotice(createStuckAccount(count), 'fr');

    expect(screen.getByRole('alert', { name: text })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeOnTheScreen();
    await user.press(
      screen.getByRole('button', {
        name: "Abandonner les modifications qui n'ont pas pu être synchronisées",
      }),
    );
    expect(within(screen.getByTestId(SHEET_TEST_ID)).getByText(sheet)).toBeOnTheScreen();
  });

  it('follows the stuck count, and goes once none is left', async () => {
    const stuck = createStuckAccount(2);
    await renderNotice(stuck);

    await setStuckCount(stuck, 1);
    expect(screen.getByRole('alert', { name: noticeText(1) })).toBeOnTheScreen();

    await setStuckCount(stuck, 0);
    expect(screen.queryByTestId(TEST_ID)).not.toBeOnTheScreen();
  });

  it('retries, labelled as pending with Discard disabled until the run settled', async () => {
    const stuck = createStuckAccount(2);
    const run = createDeferred<LibraryReplayRun>();
    stuck.account.retryStuckWrites.mockReturnValueOnce(run.promise);
    const user = await renderNotice(stuck);

    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(stuck.account.retryStuckWrites).toHaveBeenCalledTimes(1);
    const pending = screen.getByRole('button', { name: RETRYING_LABEL });
    expect(pending).toBe(screen.getByTestId(`${TEST_ID}-retry`));
    expect(pending).toBeDisabled();
    expect(pending).toBeBusy();
    expect(screen.getByRole('button', { name: DISCARD_LABEL })).toBeDisabled();

    await act(async () => {
      run.resolve({ status: 'done', confirmed: 1 });
      stuck.setStuckCount(1);
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(screen.getByRole('button', { name: DISCARD_LABEL })).toBeEnabled();
    expect(screen.getByRole('alert', { name: noticeText(1) })).toBeOnTheScreen();
  });

  it('asks before discarding, with the count, and Cancel keeps everything', async () => {
    const stuck = createStuckAccount(2);
    const user = await renderNotice(stuck);
    expect(screen.queryByTestId(SHEET_TEST_ID)).not.toBeOnTheScreen();

    const sheet = await openDiscardSheet(user);

    expect(within(sheet).getByRole('header', { name: 'Discard these changes?' })).toBeOnTheScreen();
    expect(within(sheet).getByText(sheetText(2))).toBeOnTheScreen();
    expect(within(sheet).getByRole('button', { name: 'Discard them' })).toBe(
      within(sheet).getByTestId(`${SHEET_TEST_ID}-confirm`),
    );

    await user.press(within(sheet).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId(SHEET_TEST_ID)).not.toBeOnTheScreen();
    expect(stuck.account.discardStuckWrites).not.toHaveBeenCalled();
    expect(screen.getByRole('alert', { name: noticeText(2) })).toBeOnTheScreen();
  });

  it('keeps everything when the sheet is closed', async () => {
    const stuck = createStuckAccount(1);
    const user = await renderNotice(stuck);
    await openDiscardSheet(user);

    await user.press(screen.getByRole('button', { name: 'Close without discarding' }));

    expect(screen.queryByTestId(SHEET_TEST_ID)).not.toBeOnTheScreen();
    expect(stuck.account.discardStuckWrites).not.toHaveBeenCalled();
  });

  it('shows the live count in the sheet', async () => {
    const stuck = createStuckAccount(1);
    const user = await renderNotice(stuck);
    const sheet = await openDiscardSheet(user);
    expect(within(sheet).getByText(sheetText(1))).toBeOnTheScreen();
    expect(within(sheet).getByRole('button', { name: 'Discard it' })).toBeOnTheScreen();

    await setStuckCount(stuck, 3);

    expect(within(sheet).getByText(sheetText(3))).toBeOnTheScreen();
    expect(within(sheet).getByRole('button', { name: 'Discard them' })).toBeOnTheScreen();
  });

  it('discards once confirmed with the destructive button, closes the sheet and goes', async () => {
    const stuck = createStuckAccount(2);
    stuck.account.discardStuckWrites.mockImplementationOnce(() => {
      stuck.setStuckCount(0);
      return 2;
    });
    const user = await renderNotice(stuck);
    const sheet = await openDiscardSheet(user);
    const confirm = within(sheet).getByRole('button', { name: 'Discard them' });
    expect(confirm).toHaveProp('className', expect.stringContaining('bg-danger'));

    await user.press(confirm);

    expect(stuck.account.discardStuckWrites).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(SHEET_TEST_ID)).not.toBeOnTheScreen();
    expect(screen.queryByTestId(TEST_ID)).not.toBeOnTheScreen();
  });

  it('never reopens the sheet for later stuck writes once the last one went', async () => {
    const stuck = createStuckAccount(1);
    const user = await renderNotice(stuck);
    await openDiscardSheet(user);

    await setStuckCount(stuck, 0);
    await setStuckCount(stuck, 1);

    expect(screen.getByRole('alert', { name: noticeText(1) })).toBeOnTheScreen();
    expect(screen.queryByTestId(SHEET_TEST_ID)).not.toBeOnTheScreen();
  });
});
