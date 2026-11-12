import type { ErrorReporter } from '@core/errors/error-reporter';
import { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store';

import {
  allStaleChunkKeys,
  deleteAll,
  readStoredHeader,
  SECURE_SESSION_OPTIONS,
  SECURE_SESSION_REPORT_SOURCE,
  succeeded,
} from './secure-session-chunks';

// the cleanup marker `<key>.pending`, set before a write or a removal touches a chunk or the
// header, deleted once its cleanup succeeded: found on a key's first access in a process (a kill
// or a failure since), it makes that access sweep the key first. persisted rather than a sweep at
// every launch: one marker read per key per launch and two calls per write or removal, against up
// to MAX_CHUNKS * 3 deletions per key per launch (both generations and the f-09 keys, all of them
// for a key with no value, such as a signed-out session); a sweep runs only after a kill or a
// failure
const MARKER_SUFFIX = 'pending';
const MARKER_VALUE = '1';

// not a number, so it collides with no chunk key
const markerKey = (key: string): string => `${key}.${MARKER_SUFFIX}`;

export const setMarker = (key: string): Promise<void> =>
  setItemAsync(markerKey(key), MARKER_VALUE, SECURE_SESSION_OPTIONS);

export const deleteMarker = (key: string): Promise<void> =>
  deleteItemAsync(markerKey(key), SECURE_SESSION_OPTIONS);

/**
 * the check of a key's first access in the process: when its marker is set, deletes every chunk
 * key the stored header does not point to (all of them without a valid header), the f-09 ones
 * included, then the marker. resolves whether the key is clean; a failure is reported, never
 * thrown, and leaves the key dirty (the next write or removal sweeps it) and its marker set
 */
export const sweepMarkedKey = (key: string, reporter: ErrorReporter): Promise<boolean> =>
  succeeded(async () => {
    if ((await getItemAsync(markerKey(key), SECURE_SESSION_OPTIONS)) === null) return;
    const { header } = await readStoredHeader(key);
    await deleteAll(allStaleChunkKeys(key, header, true));
    await deleteMarker(key);
  }, reporter);

/** the fixed message of a discard that failed: the caught error could quote what the key holds. */
export const DISCARD_FAILED_MESSAGE = 'Secure session stored value could not be discarded';

/** the error a failed discard reports, and rejects a write or a removal with: no cause, no value. */
export const discardFailedError = (): Error => {
  const error = new Error(DISCARD_FAILED_MESSAGE);
  error.name = 'SecureSessionDiscardError';
  return error;
};

/**
 * removes whatever the key holds, for a process that must never read what was stored before it
 * (a reinstall): the header first, so every read fails closed from then on, whatever is left,
 * then every chunk key of both generations and the f-09 ones, then the marker. a key with neither
 * a header nor a marker holds nothing a read could reach (a write sets the marker before its first
 * chunk and deletes it only once its cleanup succeeded): it costs these two reads and no deletion,
 * unless `retry` (an earlier discard of the key failed, maybe after deleting the header alone).
 * resolves whether the key holds nothing; a failure is reported with a fixed error, never the
 * caught one, and never thrown
 */
export const discardStoredKey = async (
  key: string,
  retry: boolean,
  reporter: ErrorReporter,
): Promise<boolean> => {
  try {
    const marker = await getItemAsync(markerKey(key), SECURE_SESSION_OPTIONS);
    const header = await getItemAsync(key, SECURE_SESSION_OPTIONS);
    if (!retry && marker === null && header === null) return true;
    if (header !== null) await deleteItemAsync(key, SECURE_SESSION_OPTIONS);
    await deleteAll(allStaleChunkKeys(key, undefined, true));
    if (marker !== null) await deleteMarker(key);
    return true;
  } catch {
    // the caught error is dropped, not reported: it could quote the stored value
    reporter.captureError(discardFailedError(), { source: SECURE_SESSION_REPORT_SOURCE });
    return false;
  }
};
