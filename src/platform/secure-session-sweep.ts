import type { ErrorReporter } from '@core/errors/error-reporter';
import { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store';

import {
  allStaleChunkKeys,
  deleteAll,
  readStoredHeader,
  SECURE_SESSION_OPTIONS,
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
