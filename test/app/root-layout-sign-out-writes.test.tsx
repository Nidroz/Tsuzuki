import { PROGRESS_WRITE_COALESCE_MS } from '@core/domain/library-progress';
import { LIBRARY_REPLAY_RETRY_DELAYS_MS } from '@core/repositories/local/account-library-replay';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act, fireEvent } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';

import {
  holdNextCall,
  type Deferred,
  type FakeAccountLibraryRepository,
} from '../core/fake-library-repository';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeNetworkModule from '../mobile/fake-network-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import type * as RecordingQueryClient from '../mobile/recording-query-client';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { APP_ROUTES } from './app-routes';
import {
  addOneEpisode,
  ENTRY_A,
  ENTRY_A_OTHER,
  ENTRY_B,
  libraryTab,
  pressTab,
  queuedWritesOf,
  rowOf,
  settle,
  SIGN_OUT_BUTTON,
  signOutMocks,
  storedCopyOf,
  storedQueueOf,
  tapAccount,
  UNSYNCED_SHEET,
  USER_A,
  USER_B,
} from './sign-out-support';

// the writes of a sign out through the composition root (A-06, FR-25, ADR-0018): the writes A
// dropped by confirming the sign out never reach any account, B's or A's own, later; a `+1` still
// in its coalescing window reaches A's account before the purge. every supabase factory is a fake
// (no real client), the device network a fake driving the real connectivity binding

jest.mock('@core/repositories/supabase/create-supabase-client', () =>
  jest
    .requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module')
    .fakeSupabaseClientModule(),
);
jest.mock('@core/repositories/supabase/auth-repository', () =>
  jest
    .requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module')
    .fakeSupabaseAuthModule(),
);
jest.mock('@core/repositories/supabase/library-repository', () =>
  jest
    .requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module')
    .fakeSupabaseLibraryModule(),
);
jest.mock('@core/query/query-client', () =>
  jest
    .requireActual<typeof RecordingQueryClient>('../mobile/recording-query-client')
    .recordingQueryClientModule(),
);

// no http: the library and settings tabs read no catalog data
jest.mock('@core/catalog/jikan/jikan-catalog-provider', () =>
  jest.requireActual<typeof FakeJikanModule>('../mobile/fake-jikan-module').fakeJikanModule(),
);

jest.mock('expo-network', () =>
  jest.requireActual<typeof FakeNetworkModule>('../mobile/fake-network-module').fakeNetworkModule(),
);

jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => [{ languageTag: 'en-US' }],
}));

// the layout opens its storage when it is imported: the shared instance lets the test read it
jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof SharedMmkv>('../mobile/shared-mmkv').sharedMmkvModule(),
);

const mocks = signOutMocks();

// every retry wait of a replay run, in a row: a run started before the purge has had every chance
const ALL_REPLAY_RETRIES_MS = LIBRARY_REPLAY_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);

// the number of calls each remote method of `account` received
const callCounts = (account: FakeAccountLibraryRepository) =>
  [
    account.list,
    account.get,
    account.save,
    account.remove,
    account.mergeGuestEntries,
    account.replayWrites,
  ].map(({ mock }) => mock.calls.length);

// every argument `account` received, as text
const sentTo = (account: FakeAccountLibraryRepository): string =>
  JSON.stringify([
    account.save.mock.calls,
    account.remove.mock.calls,
    account.mergeGuestEntries.mock.calls,
    account.replayWrites.mock.calls,
  ]);

// the replays a test held: released after it, so a failed test leaves no run of a user pending
// in the account libraries of the layout, which live as long as the test file
const heldReplays: Deferred<void>[] = [];

beforeEach(() => {
  mocks.reset();
});

afterEach(async () => {
  for (const held of heldReplays.splice(0)) {
    held.resolve();
  }
  await mocks.restore();
});

describe('root layout sign out writes (A-06)', () => {
  it("never sends the writes A dropped at sign out, to B's account or to A's at A's next sign in", async () => {
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
    await mocks.reportSession(USER_A);
    expect(await libraryTab().findByTestId(rowOf(ENTRY_A))).toBeOnTheScreen();
    await mocks.setDeviceOnline(false);
    await addOneEpisode(ENTRY_A);
    await addOneEpisode(ENTRY_A_OTHER);
    expect(queuedWritesOf(USER_A)).toHaveLength(2);

    await pressTab('settings');
    await tapAccount(SIGN_OUT_BUTTON);
    await tapAccount(`${UNSYNCED_SHEET}-confirm`);

    const accountA = mocks.accountOf(0);
    expect(mocks.auth().signOut).toHaveBeenCalledTimes(1);
    expect(accountA.save).not.toHaveBeenCalled();
    expect(accountA.replayWrites).not.toHaveBeenCalled();
    const callsOfA = callCounts(accountA);

    // the device reconnects, B signs in, changes an entry offline, and B's queue replays online
    await mocks.setDeviceOnline(true);
    await mocks.reportSession(USER_B);
    await pressTab('library');
    expect(await libraryTab().findByTestId(rowOf(ENTRY_B))).toBeOnTheScreen();
    await mocks.setDeviceOnline(false);
    await addOneEpisode(ENTRY_B);
    const queuedOfB = queuedWritesOf(USER_B);
    expect(queuedOfB).toStrictEqual([
      { type: 'save', entry: expect.objectContaining({ key: ENTRY_B.key, progress: 13 }) },
    ]);
    await mocks.setDeviceOnline(true);
    await settle(ALL_REPLAY_RETRIES_MS);

    const accountB = mocks.accountOf(1);
    expect(mocks.accountUserIds()).toStrictEqual([USER_A, USER_B]);
    expect(accountB.replayWrites.mock.calls).toStrictEqual([[queuedOfB]]);
    expect(accountB.stored(ENTRY_B.key)?.progress).toBe(13);
    for (const { key, media } of [ENTRY_A, ENTRY_A_OTHER]) {
      expect(accountB.stored(key)).toBeNull();
      expect(sentTo(accountB)).not.toContain(media.title);
    }
    // nothing more reached A's account while B was signed in
    expect(callCounts(accountA)).toStrictEqual(callsOfA);
    expect(storedQueueOf(USER_A)).toBeUndefined();

    // user A signs in again: the dropped writes are gone for good, never replayed
    await mocks.reportSession(null);
    await mocks.reportSession(USER_A);
    await settle(ALL_REPLAY_RETRIES_MS);

    const accountAgain = mocks.accountOf(2);
    expect(mocks.accountUserIds()).toStrictEqual([USER_A, USER_B, USER_A]);
    expect(accountAgain.replayWrites).not.toHaveBeenCalled();
    expect(accountAgain.save).not.toHaveBeenCalled();
    expect(accountAgain.stored(ENTRY_A.key)?.progress).toBe(ENTRY_A.progress);
    expect(callCounts(accountA)).toStrictEqual(callsOfA);
    expect(queuedWritesOf(USER_A)).toStrictEqual([]);
  });

  it("sends a `+1` still in its coalescing window to A's account before the purge", async () => {
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
    await mocks.reportSession(USER_A);
    expect(await libraryTab().findByTestId(rowOf(ENTRY_A))).toBeOnTheScreen();
    const accountA = mocks.accountOf(0);

    // the `+1`, the tab and the sign out pressed without any time passing: the window still runs
    await fireEvent.press(
      libraryTab().getByRole('button', { name: `Add one episode, ${ENTRY_A.media.title}` }),
    );
    await fireEvent.press(screen.getByTestId('tab-settings'));
    expect(accountA.save).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId(SIGN_OUT_BUTTON));
    await settle();

    // sent under A's session, before the session ended; nothing left queued on the device
    expect(accountA.save).toHaveBeenCalledTimes(1);
    expect(accountA.save).toHaveBeenCalledWith(
      expect.objectContaining({ key: ENTRY_A.key, progress: 13 }),
    );
    expect(accountA.stored(ENTRY_A.key)?.progress).toBe(13);
    const [saveOrder] = accountA.save.mock.invocationCallOrder;
    const [signOutOrder] = mocks.auth().signOut.mock.invocationCallOrder;
    expect(saveOrder).toBeLessThan(signOutOrder ?? 0);
    expect(screen.queryByTestId(UNSYNCED_SHEET)).not.toBeOnTheScreen();
    expect(screen.getByTestId('settings-account-sign-in')).toBeOnTheScreen();

    // the window ends: nothing more is sent, and A's documents stay gone
    await settle(PROGRESS_WRITE_COALESCE_MS);
    expect(accountA.save).toHaveBeenCalledTimes(1);
    expect(storedQueueOf(USER_A)).toBeUndefined();
    expect(storedCopyOf(USER_A)).toBeUndefined();
  });

  it('sends or asks about a `+1` made while the sign out syncs, never drops it silently', async () => {
    mocks.setUpNextAccount((repository) => {
      heldReplays.push(holdNextCall(repository, 'replayWrites'));
    });
    await renderRouterAsync(APP_ROUTES, { initialUrl: '/library' });
    await mocks.reportSession(USER_A);
    expect(await libraryTab().findByTestId(rowOf(ENTRY_A))).toBeOnTheScreen();
    const accountA = mocks.accountOf(0);
    // a change queued offline; at the reconnect its replay reaches a slow server
    await mocks.setDeviceOnline(false);
    await addOneEpisode(ENTRY_A);
    await mocks.setDeviceOnline(true);
    expect(accountA.replayWrites).toHaveBeenCalledTimes(1);

    // the sign out syncs (its replay joins the held one) while A makes a `+1` in the library
    await pressTab('settings');
    await tapAccount(SIGN_OUT_BUTTON);
    expect(mocks.auth().signOut).not.toHaveBeenCalled();
    await pressTab('library');
    await fireEvent.press(
      libraryTab().getByRole('button', { name: `Add one episode, ${ENTRY_A_OTHER.media.title}` }),
    );
    await settle();
    expect(libraryTab().getByTestId(rowOf(ENTRY_A_OTHER))).toHaveTextContent('13 / 28 episodes', {
      exact: false,
    });
    await act(async () => {
      heldReplays[0]?.resolve();
      await jest.advanceTimersByTimeAsync(0);
    });
    await settle(PROGRESS_WRITE_COALESCE_MS);

    // the queued change reached A's account; the `+1` made meanwhile did too, or A is asked
    // before losing it: never signed out with the change dropped
    expect(accountA.stored(ENTRY_A.key)?.progress).toBe(13);
    const outcome = {
      sent: accountA.stored(ENTRY_A_OTHER.key)?.progress === 13,
      asked: screen.queryByTestId(UNSYNCED_SHEET) !== null,
      signedOut: mocks.auth().signOut.mock.calls.length > 0,
    };
    expect(outcome).not.toStrictEqual({ sent: false, asked: false, signedOut: true });
  });
});
