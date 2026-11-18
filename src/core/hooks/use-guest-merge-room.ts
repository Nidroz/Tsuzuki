import { onlineManager } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { LibraryEntry } from '../domain/library-entry';
import type { MediaKey } from '../domain/media';
import { LibraryRemoteError } from '../errors/library-errors';
import { LibraryFailureError } from '../errors/library-report-errors';
import type { OfflineAccountLibraryRepository } from '../repositories/offline-account-library-repository';
import type { GuestMergeValue } from './guest-merge-context';
import {
  GUEST_MERGE_ROOM_REPORT_SOURCE,
  guestMergeRoomEntriesOf,
  removeConfirmed,
  type GuestMergeRoom,
  type GuestMergeRoomEntries,
  type GuestMergeRoomFailure,
  type GuestMergeRoomStatus,
  type UseGuestMergeRoomOptions,
} from './guest-merge-room';
import { useSessionLibrary } from './session-library-context';
import { useCatalogProvider } from './use-catalog-provider';
import { useDevicePurgeContext } from './use-device-purge';
import { useGuestMerge } from './use-guest-merge';
import { useLatest } from './use-latest';

export { GUEST_MERGE_ROOM_FAILURES, GUEST_MERGE_ROOM_REPORT_SOURCE } from './guest-merge-room';
export type {
  GuestMergeRoom,
  GuestMergeRoomFailure,
  GuestMergeRoomStatus,
  UseGuestMergeRoomOptions,
} from './guest-merge-room';

// one refusal of the merge at the cap: the account instance and the merge value it came with. a
// retry refused again comes with a new merge value: a new refusal, read afresh, nothing running
interface Refusal {
  readonly account: OfflineAccountLibraryRepository;
  readonly merge: GuestMergeValue;
}

interface Read {
  readonly refusal: Refusal;
  readonly request: number;
  /** null when the read failed */
  readonly entries: readonly LibraryEntry[] | null;
}

interface Removal {
  readonly refusal: Refusal;
  /** the key removed now, null once its removal succeeded and the merge restarts */
  readonly key: MediaKey | null;
}

interface FailureState {
  readonly refusal: Refusal | null;
  readonly failure: GuestMergeRoomFailure | null;
  readonly id: number;
}

const NOTHING_SHOWN: GuestMergeRoomEntries = { entries: [], hiddenCount: 0 };
const NO_FAILURE: FailureState = { refusal: null, failure: null, id: 0 };
const FIRST_REQUEST = 0;

/**
 * the account library of the session while its guest merge is refused at the entry cap (ADR-0016
 * "Merge at the entry cap", R-09): the live library stays the pending one, so the only write is a
 * removal from the account, which lowers its count, after which the merge is retried; the guest
 * store is never touched. active only while useGuestMerge() is `failed` with `library-full` and
 * useSessionLibrary() has an account instance. the entries are read with `account.list()` once per
 * refusal (each retry refused again reads afresh), kept in this hook: no query key. a removal
 * while offline writes nothing and says so, and so does one the server did not confirm (kept
 * queued, told per call by removeConfirmed). an unexpected failure is reported to the reporter of
 * the DevicePurgeContextProvider as a fixed LibraryFailureError('guest-merge-room'), told apart
 * from a failed merge run, with GUEST_MERGE_ROOM_REPORT_SOURCE only. throws outside
 * SessionLibraryContextProvider, DevicePurgeContextProvider or CatalogContextProvider
 */
export const useGuestMergeRoom = ({ showAdult }: UseGuestMergeRoomOptions): GuestMergeRoom => {
  const merge = useGuestMerge();
  const { account } = useSessionLibrary();
  const { namespace, imageHosts } = useCatalogProvider();
  const latestReporter = useLatest(useDevicePurgeContext().reporter);
  const refusal = useMemo(
    (): Refusal | null =>
      account !== null && merge.status === 'failed' && merge.failure === 'library-full'
        ? { account, merge }
        : null,
    [account, merge],
  );
  const latestRefusal = useLatest(refusal);

  const report = useCallback(() => {
    latestReporter.current.captureError(new LibraryFailureError('guest-merge-room'), {
      source: GUEST_MERGE_ROOM_REPORT_SOURCE,
    });
  }, [latestReporter]);

  const [request, setRequest] = useState(FIRST_REQUEST);
  const [read, setRead] = useState<Read | null>(null);
  useEffect(() => {
    if (refusal === null) {
      return undefined;
    }
    // a read of an earlier refusal or request is never shown
    let current = true;
    refusal.account.list().then(
      (entries) => {
        if (current) {
          setRead({ refusal, request, entries });
        }
      },
      (error: unknown) => {
        // the account store reports its own failures; anything else, even for a read not shown
        if (!(error instanceof LibraryRemoteError)) {
          report();
        }
        if (current) {
          setRead({ refusal, request, entries: null });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [refusal, request, report]);

  const answered =
    refusal !== null && read !== null && read.refusal === refusal && read.request === request
      ? read.entries
      : undefined;
  let status: GuestMergeRoomStatus = 'loading';
  if (answered !== undefined) {
    status = answered === null ? 'error' : 'ready';
  }
  const shown = useMemo(
    (): GuestMergeRoomEntries =>
      answered === undefined || answered === null
        ? NOTHING_SHOWN
        : guestMergeRoomEntriesOf(answered, showAdult, { namespace, imageHosts }),
    [answered, showAdult, namespace, imageHosts],
  );

  const [removal, setRemoval] = useState<Removal | null>(null);
  const [failed, setFailed] = useState<FailureState>(NO_FAILURE);
  // the refusal a removal runs or succeeded in, set synchronously: a second tap before the next
  // render is ignored. a new refusal frees it
  const busyRef = useRef<Refusal | null>(null);

  const remove = useCallback(
    (key: MediaKey) => {
      if (refusal === null || busyRef.current === refusal) {
        return;
      }
      const fail = (failure: GuestMergeRoomFailure): void => {
        setFailed((previous) => ({ refusal, failure, id: previous.id + 1 }));
      };
      setFailed((previous) =>
        previous.failure === null ? previous : { ...previous, failure: null },
      );
      // nothing is queued for later: the merge needs the server too
      if (!onlineManager.isOnline()) {
        fail('offline');
        return;
      }
      const release = (): void => {
        if (busyRef.current === refusal) {
          busyRef.current = null;
        }
        setRemoval(null);
      };
      busyRef.current = refusal;
      setRemoval({ refusal, key });
      removeConfirmed(refusal.account, key).then(
        (confirmed) => {
          if (!confirmed) {
            release();
            fail('offline');
            return;
          }
          // busy until the merge value changes; a session that moved on retries nothing
          setRemoval({ refusal, key: null });
          if (latestRefusal.current === refusal) {
            refusal.merge.retry();
          }
        },
        (error: unknown) => {
          if (!(error instanceof LibraryRemoteError)) {
            report();
          }
          release();
          fail('failed');
        },
      );
    },
    [refusal, latestRefusal, report],
  );

  const retry = useCallback(() => {
    if (refusal !== null && busyRef.current !== refusal) {
      refusal.merge.retry();
    }
  }, [refusal]);

  const reload = useCallback(() => {
    if (refusal !== null) {
      setRequest((previous) => previous + 1);
    }
  }, [refusal]);

  const running = refusal !== null && removal !== null && removal.refusal === refusal;
  const removingKey = running ? removal.key : null;
  const failure = refusal !== null && failed.refusal === refusal ? failed.failure : null;
  const failureId = failed.id;
  const active = refusal !== null;
  const { entries, hiddenCount } = shown;
  return useMemo(
    () => ({
      active,
      status,
      entries,
      hiddenCount,
      reload,
      busy: running,
      removingKey,
      failure,
      failureId,
      remove,
      retry,
    }),
    [
      active,
      status,
      entries,
      hiddenCount,
      reload,
      running,
      removingKey,
      failure,
      failureId,
      remove,
      retry,
    ],
  );
};
