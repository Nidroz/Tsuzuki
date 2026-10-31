// a library writer over a fake repository and a real query client, with library changes, for the
// library writer tests (src/core/hooks/library-writer*.test.ts)
import { createFakeLibraryRepository, type FakeLibraryRepository } from './fake-library-repository';
import { ENTRY_KEY, entryOf, keyOf } from './library-entry-fixtures';
import type { QueryClient } from '@tanstack/react-query';
import { setScore } from '@core/domain/library-details';
import type { LibraryEntry, LibraryStatus } from '@core/domain/library-entry';
import { incrementProgress, setStatus } from '@core/domain/library-progress';
import type { MediaKey } from '@core/domain/media';
import { queryKeys, toLibraryScope } from '@core/query/keys';
import { createQueryClient } from '@core/query/query-client';
import {
  createLibraryWriter,
  type LibraryChange,
  type LibraryWriter,
} from '@core/hooks/library-writer';

export const OTHER_KEY = keyOf('manga', 2);

/** the cache scope of the writer of setupWriter: every library key of these tests holds it */
export const SCOPE = toLibraryScope(1);

/** the stored entry of ENTRY_KEY (progress 12 of 28, score 9) */
export const ENTRY = entryOf();
export const OTHER_ENTRY = entryOf({ key: OTHER_KEY });

// enough rounds for the writer's promise chains (cancel, queue, write) to settle
const MICROTASK_ROUNDS = 20;

/** lets every settled promise run its callbacks, without moving the fake clock */
export const flushMicrotasks = async (): Promise<void> => {
  for (let round = 0; round < MICROTASK_ROUNDS; round += 1) {
    await Promise.resolve();
  }
};

/** the `+1` button rule on an entry in the library */
export const increment: LibraryChange = (entry, ctx) =>
  entry === null ? null : incrementProgress(entry, ctx);

export const scoreOf =
  (score: number | null): LibraryChange =>
  (entry, ctx) =>
    entry === null ? null : setScore(entry, score, ctx);

export const statusOf =
  (status: LibraryStatus): LibraryChange =>
  (entry, ctx) =>
    entry === null ? null : setStatus(entry, status, ctx);

export const removeEntry: LibraryChange = () => null;

export interface WriterSetup {
  readonly queryClient: QueryClient;
  readonly repository: FakeLibraryRepository;
  readonly writer: LibraryWriter;
  /** loads the entry of a key into the cache through the writer, as the entry query does */
  readonly load: (key?: MediaKey) => Promise<LibraryEntry | null>;
  /** the cached entry of a key, undefined when not loaded */
  readonly cached: (key?: MediaKey) => LibraryEntry | null | undefined;
}

/** a writer over a fake repository holding `initial`, ENTRY by default */
export const setupWriter = (
  initial: readonly LibraryEntry[] = [ENTRY],
  now?: () => Date,
): WriterSetup => {
  const queryClient = createQueryClient();
  const repository = createFakeLibraryRepository(initial);
  const writer = createLibraryWriter(
    now === undefined
      ? { queryClient, repository, scope: SCOPE }
      : { queryClient, repository, scope: SCOPE, now },
  );
  return {
    queryClient,
    repository,
    writer,
    load: (key = ENTRY_KEY) =>
      queryClient.query({
        queryKey: queryKeys.library.entry(SCOPE, key),
        queryFn: () => writer.read(key),
      }),
    cached: (key = ENTRY_KEY) =>
      queryClient.getQueryData<LibraryEntry | null>(queryKeys.library.entry(SCOPE, key)),
  };
};
