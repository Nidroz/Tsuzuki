import {
  getItem,
  setItem,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  type SecureStoreOptions,
} from 'expo-secure-store';
import { z } from 'zod';

/**
 * a cryptographically secure random source with the web crypto signature (expo-crypto has the
 * same): fills the array with random bytes and returns it
 */
export type GetRandomValues = (array: Uint8Array) => Uint8Array;

// the secure-store name of the app storage key: secure-store accepts [A-Za-z0-9._-], and the
// session keys (sb-<project>-auth-token and its dotted chunks) never take this name
export const APP_STORAGE_KEY_NAME = 'tsuzuki-app-storage-key';

// the same accessibility as the session: readable only while the device is unlocked, and never
// migrated to another device by a backup
export const APP_STORAGE_KEY_OPTIONS: SecureStoreOptions = {
  keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// mmkv aes-256 takes a key of at most 32 bytes: 32 ascii characters
export const APP_STORAGE_KEY_LENGTH = 32;

// the url-safe base64 alphabet. 64 characters and 256 % 64 === 0, so the low 6 bits of a random
// byte pick each character with the same probability: 6 bits per character, 192 bits per key
const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const KEY_ALPHABET_MASK = KEY_ALPHABET.length - 1;

const KEY_FORM = new RegExp(`^[A-Za-z0-9_-]{${String(APP_STORAGE_KEY_LENGTH)}}$`);

/** a stored key is untrusted: exactly 32 characters of the url-safe base64 alphabet. */
export const appStorageKeySchema = z.string().regex(KEY_FORM);

/**
 * a new key from 32 bytes of the injected source, one character per byte. throws what the source
 * throws, and a RangeError with a fixed message, never holding a byte or the key, when the source
 * returns an array other than the one it was given, detaches it, or leaves every byte at zero
 */
export const generateAppStorageKey = (getRandomValues: GetRandomValues): string => {
  const bytes = new Uint8Array(APP_STORAGE_KEY_LENGTH);
  // the web crypto contract: the source fills the array it is given and returns that array.
  // another one could be of another length or shared, and the given one left unfilled
  if (getRandomValues(bytes) !== bytes) {
    throw new RangeError('the random source returned another array than the one it was given');
  }
  // the array owns a buffer of fixed length: only a detached buffer changes it (to 0)
  if (bytes.length !== APP_STORAGE_KEY_LENGTH) {
    throw new RangeError('the random source detached the array it was given');
  }
  // 32 random bytes are all zero with a chance of 2^-256: a source that filled nothing
  if (bytes.every((byte) => byte === 0)) {
    throw new RangeError('the random source left every byte at zero');
  }
  return Array.from(bytes, (byte) => KEY_ALPHABET.charAt(byte & KEY_ALPHABET_MASK)).join('');
};

/** the stored key: a valid one, none, or a value of another form (handled as a lost key). */
export type StoredAppStorageKey =
  | { readonly status: 'valid'; readonly key: string }
  | { readonly status: 'missing' }
  | { readonly status: 'invalid' };

/**
 * reads the key synchronously from the secure store. throws when the secure store cannot be read
 * (a locked device, a keychain or keystore failure); the caller never reports that error, which
 * could quote the stored value
 */
export const readAppStorageKey = (): StoredAppStorageKey => {
  const stored = getItem(APP_STORAGE_KEY_NAME, APP_STORAGE_KEY_OPTIONS);
  if (stored === null) return { status: 'missing' };
  const parsed = appStorageKeySchema.safeParse(stored);
  return parsed.success ? { status: 'valid', key: parsed.data } : { status: 'invalid' };
};

/** stores the key synchronously in the secure store; throws when it cannot be written. */
export const writeAppStorageKey = (key: string): void => {
  setItem(APP_STORAGE_KEY_NAME, key, APP_STORAGE_KEY_OPTIONS);
};
