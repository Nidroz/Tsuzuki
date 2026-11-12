import type { StorageAdapter } from '@core/repositories/storage-adapter';
import {
  getItem,
  setItem,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  type SecureStoreOptions,
} from 'expo-secure-store';

import { MAX_CHUNK_BYTES } from './secure-session-chunks';

// the secure-store name of a document is this prefix then its key. no other item takes a name
// under it: the app storage key (tsuzuki-app-storage-key) has no dot, and every name of the secure
// session storage is a key of [\w-] alone, or one followed by .pending, .<index> or
// .<generation>.<index>, never by a second segment such as documents
export const SECURE_DOCUMENT_PREFIX = 'tsuzuki.documents.';

// readable only while the device is unlocked, never migrated to another device by a backup: the
// same accessibility as the session and the app storage key
export const SECURE_DOCUMENT_OPTIONS: SecureStoreOptions = {
  keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// secure-store values over 2048 utf-8 bytes are unreliable (the limit the session chunks keep)
export const MAX_SECURE_DOCUMENT_BYTES = MAX_CHUNK_BYTES;

// lowercase letters and digits, words joined by single dots or dashes: device-purge-pending
const DOCUMENT_KEY = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

// expo-secure-store 57 deletes only asynchronously, and a deletion landing after a later
// synchronous write would erase it: a deletion writes this empty value instead, read as no value
const TOMBSTONE = '';

const encoder = new TextEncoder();

// the error never quotes the key: a key may hold a user id
const nameOf = (key: string): string => {
  if (!DOCUMENT_KEY.test(key)) {
    throw new TypeError(
      'invalid secure document key: lowercase letters and digits, joined by single dots or dashes',
    );
  }
  return `${SECURE_DOCUMENT_PREFIX}${key}`;
};

/**
 * a synchronous StorageAdapter over expo-secure-store, for the few small documents that must last
 * when the app storage cannot be opened. while the app storage runs on memory, each device purge
 * records its user there (the core marker repository, createLocalDevicePurgeMarkerRepository,
 * over this adapter), and the next launch on the files carries them into the purge markers.
 *
 * each key is stored under SECURE_DOCUMENT_PREFIX with WHEN_UNLOCKED_THIS_DEVICE_ONLY; a key that
 * is not lowercase words joined by dots or dashes throws a TypeError before any call. a value over
 * 2048 utf-8 bytes throws a RangeError holding no value, before any write. a deletion writes an
 * empty value (a tombstone), synchronously like every call, and an empty value reads as no value:
 * set(key, '') is a deletion. every call blocks the javascript thread on the keychain or keystore,
 * and throws what the secure store throws (a locked device, a keychain failure): the caller never
 * reports that error, which could quote a document. stored content is untrusted: the reader parses
 * it with zod. like the session, the items outlive an ios uninstall
 */
export const createSecureDocumentStorage = (): StorageAdapter => ({
  getString: (key) => {
    const stored = getItem(nameOf(key), SECURE_DOCUMENT_OPTIONS);
    return stored === null || stored === TOMBSTONE ? undefined : stored;
  },
  set: (key, value) => {
    const name = nameOf(key);
    if (encoder.encode(value).length > MAX_SECURE_DOCUMENT_BYTES) {
      throw new RangeError(
        `secure document value over ${String(MAX_SECURE_DOCUMENT_BYTES)} utf-8 bytes`,
      );
    }
    setItem(name, value, SECURE_DOCUMENT_OPTIONS);
  },
  delete: (key) => {
    setItem(nameOf(key), TOMBSTONE, SECURE_DOCUMENT_OPTIONS);
  },
});
