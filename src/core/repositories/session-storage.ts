/**
 * async storage for the auth session, shape compatible with supabase-js `auth.storage`
 * (expo-secure-store with chunked values on mobile).
 * the only place the session is stored: never backed by `StorageAdapter` or MMKV.
 */
export interface SessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
