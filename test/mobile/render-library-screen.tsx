// renders the library screen over an in-memory library repository, for the LibraryScreen tests.
// the tests mock expo-router's router themselves
import type { ErrorReporter } from '@core/errors/error-reporter';
import type { GuestMergeValue } from '@core/hooks/guest-merge-context';
import type { Language } from '@core/i18n/index';
import { LibraryContextProvider } from '@core/hooks/LibraryContextProvider';
import { PENDING_LIBRARY_REPOSITORY } from '@core/hooks/SessionLibraryContextProvider';
import { createQueryClient } from '@core/query/query-client';
import { jest } from '@jest/globals';
import type { QueryClient } from '@tanstack/react-query';
import { act, screen, userEvent } from '@testing-library/react-native';

import { LibraryScreen } from '@features/library/LibraryScreen';
import { LIBRARY } from '@features/library/__fixtures__/library-entries';
import { fullMergeOf, ROOM_ENTRIES } from '@features/library/__fixtures__/merge-room';
import {
  createFakeGuestLibraryRepository,
  createFakeLibraryRepository,
  type FakeLibraryRepository,
} from '../core/fake-library-repository';
import { createStuckAccount, type FakeOfflineAccount } from '../core/stuck-account';
import {
  IDLE_GUEST_MERGE,
  renderWithProviders,
  type SessionLibraryOption,
} from './render-with-providers';

export interface LibraryScreenSetup {
  /** the repository of the screen; a fake holding LIBRARY by default */
  readonly repository?: FakeLibraryRepository;
  readonly language?: Language;
  /** the query cache of the screen; a new one by default */
  readonly queryClient?: QueryClient;
  /** the adult content setting (BR-06), off by default */
  readonly showAdult?: boolean;
  /** the guest merge state the screen reads, IDLE_GUEST_MERGE by default */
  readonly guestMerge?: GuestMergeValue;
  /** the libraries of the session; no account instance by default (render-with-providers) */
  readonly sessionLibrary?: SessionLibraryOption;
  /** the reporter of the tree; by default a report fails the test (render-with-providers) */
  readonly reporter?: ErrorReporter;
  /** the live library is the pending one (a guest merge not done), not `repository` */
  readonly pending?: boolean;
}

/** renders LibraryScreen over a fake library repository and returns it with a user */
export const renderLibraryScreen = async ({
  repository = createFakeLibraryRepository(LIBRARY),
  language = 'en',
  queryClient = createQueryClient(),
  showAdult = false,
  guestMerge = IDLE_GUEST_MERGE,
  sessionLibrary,
  reporter,
  pending = false,
}: LibraryScreenSetup = {}) => {
  await renderWithProviders(
    <LibraryContextProvider repository={pending ? PENDING_LIBRARY_REPOSITORY : repository}>
      <LibraryScreen />
    </LibraryContextProvider>,
    {
      language,
      queryClient,
      showAdult,
      guestMerge,
      ...(sessionLibrary !== undefined && { sessionLibrary }),
      ...(reporter !== undefined && { reporter }),
    },
  );
  return { repository, user: userEvent.setup() };
};

export interface MergeRoomScreenSetup {
  /** the session's account instance; a fake holding ROOM_ENTRIES by default */
  readonly account?: FakeOfflineAccount;
  /** the guest merge, refused at the cap by default (fullMergeOf) */
  readonly merge?: GuestMergeValue;
  readonly language?: Language;
  readonly showAdult?: boolean;
}

/**
 * renders LibraryScreen while the guest merge is refused at the cap (R-09): the live library
 * pending, `account` the session's account instance, a recording reporter
 */
export const renderMergeRoomScreen = async ({
  account = createStuckAccount(0, ROOM_ENTRIES).account,
  merge = fullMergeOf(),
  language = 'en',
  showAdult = false,
}: MergeRoomScreenSetup = {}) => {
  const captureError = jest.fn<ErrorReporter['captureError']>();
  const { user } = await renderLibraryScreen({
    pending: true,
    guestMerge: merge,
    sessionLibrary: { account, guest: createFakeGuestLibraryRepository() },
    reporter: { captureError },
    language,
    showAdult,
  });
  return { account, merge, captureError, user };
};

/** lets the pending repository calls settle, after `ms` of fake time */
export const settle = async (ms = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

type ShownElement = ReturnType<typeof screen.getByText>;

// the item index of the list cell holding `element`: flashlist renders its cells in recycling
// order, so the tree order says nothing of the list order once the items change
const cellIndexOf = (element: ShownElement): number => {
  for (let node = element.parent; node !== null; node = node.parent) {
    const index: unknown = node.props.index;
    if (typeof index === 'number') {
      return index;
    }
  }
  throw new Error('the element is not in a list cell');
};

/** `elements` (each in a list cell) in the order of the list items */
export const inListOrder = (elements: readonly ShownElement[]): readonly ShownElement[] =>
  elements
    .map((element) => ({ element, index: cellIndexOf(element) }))
    .sort((a, b) => a.index - b.index)
    .map(({ element }) => element);

/** the texts matching `pattern` (section headers, row titles), in the order of the list items */
export const textsInListOrder = (pattern: RegExp): readonly string[] =>
  inListOrder(screen.getAllByText(pattern)).map((element) => String(element.props.children));
