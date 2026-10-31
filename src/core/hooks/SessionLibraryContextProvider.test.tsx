import { describe, expect, it, jest } from '@jest/globals';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';

import { flushSessionReports } from '../../../test/core/auth-hooks-support';
import {
  createSessionAuthRepository,
  createSessionSource,
} from '../../../test/core/fake-auth-repository';
import {
  createFakeLibraryRepository,
  type FakeLibraryRepository,
} from '../../../test/core/fake-library-repository';
import { ENTRY_KEY, entryOf } from '../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from '../domain/library-entry';
import { createQueryClient } from '../query/query-client';
import { noCaptcha, type AuthRepository, type AuthSession } from '../repositories/auth-repository';
import type { LibraryRepository } from '../repositories/library-repository';
import { AuthContextProvider } from './AuthContextProvider';
import {
  PENDING_LIBRARY_REPOSITORY,
  SessionLibraryContextProvider,
} from './SessionLibraryContextProvider';
import { useLibraryContext } from './use-library-context';
import { useLibraryEntry } from './use-library-entry';

// placeholder user ids
const USER_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

// the entry of ENTRY_KEY in each library: one media, a different progress per owner
const GUEST_ENTRY = entryOf({ progress: 1 });
const ENTRY_A = entryOf({ progress: 2 });
const ENTRY_B = entryOf({ progress: 3 });
const ACCOUNT_ENTRIES: ReadonlyMap<string, LibraryEntry> = new Map([
  [USER_A, ENTRY_A],
  [USER_B, ENTRY_B],
]);
// longer than any write or read of the fakes: what is pending then stays pending
const LONG_WAIT_MS = 60_000;

// what each committed render showed: the library it read and the entry of ENTRY_KEY
interface Shown {
  readonly repository: LibraryRepository;
  readonly entry: LibraryEntry | null | undefined;
}

const renderSessionLibrary = (auth: AuthRepository) => {
  const guest = createFakeLibraryRepository([GUEST_ENTRY]);
  const accountRepositoryFor = jest.fn<(userId: string) => FakeLibraryRepository>((userId) => {
    const entry = ACCOUNT_ENTRIES.get(userId);
    return createFakeLibraryRepository(entry === undefined ? [] : [entry]);
  });
  const queryClient = createQueryClient();
  const shown: Shown[] = [];
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthContextProvider repository={auth} captcha={noCaptcha}>
        <SessionLibraryContextProvider guest={guest} accountRepositoryFor={accountRepositoryFor}>
          {children}
        </SessionLibraryContextProvider>
      </AuthContextProvider>
    </QueryClientProvider>
  );
  const rendered = renderHook(
    () => {
      const { repository } = useLibraryContext();
      const entry = useLibraryEntry(ENTRY_KEY, { media: null });
      useEffect(() => {
        shown.push({ repository, entry: entry.data });
      });
      return { repository, entry };
    },
    { wrapper },
  );
  // the account repository created for the nth call (0 first)
  const accountOf = (call: number): FakeLibraryRepository => {
    const result = accountRepositoryFor.mock.results[call];
    if (result?.type !== 'return') {
      throw new Error('no account repository was created');
    }
    return result.value;
  };
  return { ...rendered, guest, accountRepositoryFor, accountOf, shown };
};

// a session the test drives, reported after subscribing like the real repository
const renderWithSession = async (initial: AuthSession | null) => {
  const source = createSessionSource(initial);
  const rendered = renderSessionLibrary(
    createSessionAuthRepository(null, { onAuthStateChange: source.subscribe }),
  );
  await flushSessionReports();
  const emit = (session: AuthSession | null) => {
    act(() => {
      source.emit(session);
    });
  };
  return { ...rendered, emit };
};

type Rendered = Awaited<ReturnType<typeof renderWithSession>>;

const showsEntry = async (rendered: Rendered, entry: LibraryEntry) => {
  await waitFor(() => {
    expect(rendered.result.current.entry.data).toStrictEqual(entry);
  });
};

describe('SessionLibraryContextProvider (A-03)', () => {
  it('shows no library while the session loads: pending, neither library called', async () => {
    // a repository that never reports the session
    const rendered = renderSessionLibrary(
      createSessionAuthRepository(null, { onAuthStateChange: () => () => undefined }),
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(LONG_WAIT_MS);
    });

    expect(rendered.result.current.repository).toBe(PENDING_LIBRARY_REPOSITORY);
    expect(rendered.result.current.entry.isPending).toBe(true);
    expect(rendered.guest.get).not.toHaveBeenCalled();
    expect(rendered.accountRepositoryFor).not.toHaveBeenCalled();
  });

  it('shows the guest library signed out', async () => {
    const rendered = await renderWithSession(null);

    await showsEntry(rendered, GUEST_ENTRY);

    expect(rendered.result.current.repository).toBe(rendered.guest);
    expect(rendered.accountRepositoryFor).not.toHaveBeenCalled();
  });

  it('shows the account library of the user signed in, one per user id across token refreshes', async () => {
    const rendered = await renderWithSession({ userId: USER_A });

    await showsEntry(rendered, ENTRY_A);
    // a token refresh reports the same user again
    rendered.emit({ userId: USER_A });

    expect(rendered.accountRepositoryFor).toHaveBeenCalledTimes(1);
    expect(rendered.accountRepositoryFor).toHaveBeenCalledWith(USER_A);
    expect(rendered.result.current.repository).toBe(rendered.accountOf(0));
    expect(rendered.guest.get).not.toHaveBeenCalled();
  });

  it('shows the guest library again after sign out, and a new account library on sign in', async () => {
    const rendered = await renderWithSession({ userId: USER_A });
    await showsEntry(rendered, ENTRY_A);

    rendered.emit(null);
    await showsEntry(rendered, GUEST_ENTRY);
    rendered.emit({ userId: USER_A });
    await showsEntry(rendered, ENTRY_A);

    expect(rendered.accountRepositoryFor).toHaveBeenCalledTimes(2);
    expect(rendered.result.current.repository).toBe(rendered.accountOf(1));
    expect(rendered.accountOf(1)).not.toBe(rendered.accountOf(0));
  });

  it("never shows a user's entries to the next user, not even for one frame", async () => {
    const rendered = await renderWithSession({ userId: USER_A });
    await showsEntry(rendered, ENTRY_A);

    rendered.emit({ userId: USER_B });
    await showsEntry(rendered, ENTRY_B);

    const accountB = rendered.accountOf(1);
    const shownForB = rendered.shown.filter((frame) => frame.repository === accountB);
    expect(shownForB.map((frame) => frame.entry)).toStrictEqual([undefined, ENTRY_B]);
  });
});
