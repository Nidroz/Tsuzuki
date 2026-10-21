import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { MediaSummary } from '../catalog/catalog-provider';
import { setNotes, setScore, notesFromInput } from '../domain/library-details';
import {
  createLibraryEntry,
  type LibraryEntry,
  type LibraryStatus,
  type LibraryWriteContext,
} from '../domain/library-entry';
import { incrementProgress, setProgress, setStatus } from '../domain/library-progress';
import { refreshMediaSnapshot } from '../domain/library-snapshot';
import type { MediaKey } from '../domain/media';
import { toLibraryMediaSnapshot } from '../schemas/library-entry';
import type { LibraryApplyOptions, LibraryChange } from './library-writer';
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
  /** the error of the last failed action, null when none; each new action clears it */
  readonly error: unknown;
  /** clears `error` */
  readonly dismissError: () => void;
}

type EntryRule = (entry: LibraryEntry, ctx: LibraryWriteContext) => LibraryEntry;

// a programming error: the ui enables add once the catalog data is loaded
const ADD_WITHOUT_MEDIA_MESSAGE = 'library add needs the media summary';

const COALESCED: LibraryApplyOptions = { coalesce: true };

const removeEntry: LibraryChange = () => null;

/**
 * the actions on the library entry of the media `key`, for a screen showing useLibraryEntry
 * (actions need the entry loaded). the callbacks are stable while the key and `media` are.
 * a rule applies to an entry in the library only (a no-op otherwise); with `media`, it first
 * refreshes the entry's snapshot (refreshMediaSnapshot): the snapshot is written with a user
 * action, never by viewing alone. the snapshot is built inside the change, so a media outside
 * the database limits fails the action, not the render
 */
export const useLibraryEntryActions = (
  key: MediaKey,
  { media }: UseLibraryEntryActionsOptions,
): LibraryEntryActions => {
  const { writer } = useLibraryContext();
  const { namespace, kind, externalId } = key;
  // the key's values, so a new key object with the same media keeps the callbacks stable
  const mediaKey = useMemo(() => ({ namespace, kind, externalId }), [namespace, kind, externalId]);
  const [error, setError] = useState<unknown>(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(
    (change: LibraryChange, options?: LibraryApplyOptions) => {
      setError(null);
      writer.apply(mediaKey, change, options).catch((reason: unknown) => {
        // a write may settle after the screen left: nothing to show then
        if (mountedRef.current) {
          setError(reason);
        }
      });
    },
    [writer, mediaKey],
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
  const dismissError = useCallback(() => {
    setError(null);
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
      error,
      dismissError,
    ],
  );
};
