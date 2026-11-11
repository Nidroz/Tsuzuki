import { useCallback, useMemo, useState } from 'react';

import type { MediaSummary } from '../catalog/catalog-provider';
import { setNotes, setScore, notesFromInput } from '../domain/library-details';
import {
  createLibraryEntry,
  favoriteMedia,
  setFavorite,
  type LibraryEntry,
  type LibraryStatus,
  type LibraryWriteContext,
} from '../domain/library-entry';
import { incrementProgress, setProgress, setStatus } from '../domain/library-progress';
import { refreshMediaSnapshot } from '../domain/library-snapshot';
import { compareMediaKeys, type MediaKey } from '../domain/media';
import {
  LIBRARY_ACTION_REPORT_SOURCE,
  LibraryActionError,
  type LibraryActionProblem,
} from '../errors/library-report-errors';
import type { LibraryScope } from '../query/keys';
import { toLibraryMediaSnapshot } from '../schemas/library-entry';
import type { LibraryApplyOptions, LibraryChange } from './library-writer';
import { useDevicePurgeContext } from './use-device-purge';
import { useLatest } from './use-latest';
import { useLibraryContext } from './use-library-context';

export interface UseLibraryEntryActionsOptions {
  /** the catalog's current data of the media (the detail screen), null when there is none yet */
  readonly media: MediaSummary | null;
}

/**
 * the library actions on one media. each is fire and forget: shown at once (optimistic), then
 * written; a failure lands in `error` and the entry refetches the stored truth
 */
export interface LibraryEntryActions {
  /** adds the media as a planned entry (FR-10); a no-op when already there. needs `media` */
  readonly add: () => void;
  /** removes the entry; a no-op when the media is not in the library */
  readonly remove: () => void;
  /** sets the status (BR-04) */
  readonly setStatus: (status: LibraryStatus) => void;
  /** sets the progress (BR-01 to BR-03); the ui validates it first with isValidProgress */
  readonly setProgress: (value: number) => void;
  /** the `+1` button (BR-01 to BR-03); rapid taps are written once (BR-09) */
  readonly incrementProgress: () => void;
  /** sets the score, null to clear it (BR-07); the ui validates it first with isValidScore */
  readonly setScore: (score: number | null) => void;
  /** saves the notes editor text: blank text clears the notes (notesFromInput, BR-07) */
  readonly setNotes: (text: string) => void;
  /**
   * the favorite toggle (FR-15): flips `isFavorite` of the entry as shown (optimistic), so two
   * quick taps toggle twice; unfavoriting keeps the entry. a media outside the library is added
   * as a planned favorite (BR-05), which needs `media`: without it, a no-op (a list row whose
   * entry was removed meanwhile)
   */
  readonly toggleFavorite: () => void;
  /**
   * the error of the last failed action of this key, null when none; each new action clears it.
   * a failure of an earlier key (a recycled list row) or of the previous library (a pending
   * change written after a library switch) is never shown
   */
  readonly error: unknown;
  /** clears `error` */
  readonly dismissError: () => void;
}

type EntryRule = (entry: LibraryEntry, ctx: LibraryWriteContext) => LibraryEntry;

// a failed action, with the key and the library scope it was made for
interface KeyedFailure {
  readonly key: MediaKey;
  readonly scope: LibraryScope;
  readonly error: unknown;
}

// a programming error: the ui enables add once the catalog data is loaded
const ADD_WITHOUT_MEDIA_MESSAGE = 'library add needs the media summary';

const COALESCED: LibraryApplyOptions = { coalesce: true };

const removeEntry: LibraryChange = () => null;

// the toggle reads the entry as shown, optimistic changes included
const flipFavorite: EntryRule = (entry, ctx) => setFavorite(entry, !entry.isFavorite, ctx);

// the programming error a failed apply tells, null for an expected failure (a write the repository
// refused or could not make, which the repositories report themselves): an apply before the entry
// was loaded, or a change a rule or the snapshot refused with a RangeError (`refused`)
const actionProblemOf = (reason: unknown, refused: boolean): LibraryActionProblem | null => {
  if (reason instanceof LibraryActionError) {
    return reason.problem;
  }
  return refused ? 'invalid-change' : null;
};

/**
 * the actions on the library entry of the media `key`, for a screen showing useLibraryEntry
 * (actions need the entry loaded). the callbacks are stable while the key and `media` are.
 * a rule applies to an entry in the library only (a no-op otherwise; add and the favorite toggle
 * create one from `media`); with `media`, it first
 * refreshes the entry's snapshot (refreshMediaSnapshot): the snapshot is written with a user
 * action, never by viewing alone. the snapshot is built inside the change, so a media outside
 * the database limits fails the action, not the render. a programming error (an action applied
 * before the entry was loaded, a RangeError of a rule or the snapshot) is also reported to the
 * reporter of the DevicePurgeContextProvider as a fixed LibraryActionError, with
 * LIBRARY_ACTION_REPORT_SOURCE only: never the caught error, a key or a value. throws outside
 * LibraryContextProvider or DevicePurgeContextProvider
 */
export const useLibraryEntryActions = (
  key: MediaKey,
  { media }: UseLibraryEntryActionsOptions,
): LibraryEntryActions => {
  const { writer, scope } = useLibraryContext();
  const latestReporter = useLatest(useDevicePurgeContext().reporter);
  const { namespace, kind, externalId } = key;
  // the key's values, so a new key object with the same media keeps the callbacks stable
  const mediaKey = useMemo(() => ({ namespace, kind, externalId }), [namespace, kind, externalId]);
  // a state update after unmount is a no-op: a write settling after the screen left shows nothing
  const [failure, setFailure] = useState<KeyedFailure | null>(null);
  const error =
    failure !== null && failure.scope === scope && compareMediaKeys(failure.key, mediaKey) === 0
      ? failure.error
      : null;

  const run = useCallback(
    (change: LibraryChange, options?: LibraryApplyOptions) => {
      setFailure(null);
      // a RangeError of this change itself: a failure of an earlier write of the key may reject
      // this apply too (library-writer), and the repositories may throw their own
      let refused = false;
      const guarded: LibraryChange = (entry, ctx) => {
        try {
          return change(entry, ctx);
        } catch (thrown) {
          refused = thrown instanceof RangeError;
          throw thrown;
        }
      };
      writer.apply(mediaKey, guarded, options).catch((reason: unknown) => {
        const problem = actionProblemOf(reason, refused);
        if (problem !== null) {
          latestReporter.current.captureError(new LibraryActionError(problem), {
            source: LIBRARY_ACTION_REPORT_SOURCE,
          });
        }
        setFailure({ key: mediaKey, scope, error: reason });
      });
    },
    [writer, scope, mediaKey, latestReporter],
  );

  // a rule on an entry in the library, after the snapshot refresh when the media is known
  const onEntry = useCallback(
    (rule: EntryRule): LibraryChange =>
      (entry, ctx) => {
        if (entry === null) {
          return null;
        }
        const refreshed =
          media === null ? entry : refreshMediaSnapshot(entry, toLibraryMediaSnapshot(media), ctx);
        return rule(refreshed, ctx);
      },
    [media],
  );

  const add = useCallback(() => {
    run((entry, ctx) => {
      if (entry !== null) {
        return entry;
      }
      if (media === null) {
        throw new Error(ADD_WITHOUT_MEDIA_MESSAGE);
      }
      return createLibraryEntry(mediaKey, toLibraryMediaSnapshot(media), ctx);
    });
  }, [run, media, mediaKey]);
  const remove = useCallback(() => {
    run(removeEntry);
  }, [run]);
  const changeStatus = useCallback(
    (status: LibraryStatus) => {
      run(onEntry((entry, ctx) => setStatus(entry, status, ctx)));
    },
    [run, onEntry],
  );
  const changeProgress = useCallback(
    (value: number) => {
      run(onEntry((entry, ctx) => setProgress(entry, value, ctx)));
    },
    [run, onEntry],
  );
  const increment = useCallback(() => {
    run(onEntry(incrementProgress), COALESCED);
  }, [run, onEntry]);
  const changeScore = useCallback(
    (score: number | null) => {
      run(onEntry((entry, ctx) => setScore(entry, score, ctx)));
    },
    [run, onEntry],
  );
  const changeNotes = useCallback(
    (text: string) => {
      const notes = notesFromInput(text);
      run(onEntry((entry, ctx) => setNotes(entry, notes, ctx)));
    },
    [run, onEntry],
  );
  const toggleFavorite = useCallback(() => {
    const flip = onEntry(flipFavorite);
    run((entry, ctx) => {
      if (entry !== null) {
        return flip(entry, ctx);
      }
      // null over null: a no-op, nothing is written
      return media === null
        ? null
        : favoriteMedia(null, mediaKey, toLibraryMediaSnapshot(media), ctx);
    });
  }, [run, onEntry, media, mediaKey]);
  const dismissError = useCallback(() => {
    setFailure(null);
  }, []);

  return useMemo(
    () => ({
      add,
      remove,
      setStatus: changeStatus,
      setProgress: changeProgress,
      incrementProgress: increment,
      setScore: changeScore,
      setNotes: changeNotes,
      toggleFavorite,
      error,
      dismissError,
    }),
    [
      add,
      remove,
      changeStatus,
      changeProgress,
      increment,
      changeScore,
      changeNotes,
      toggleFavorite,
      error,
      dismissError,
    ],
  );
};
