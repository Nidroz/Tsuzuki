/**
 * synchronous key-value storage (MMKV on mobile, localStorage on the web).
 * values are strings and never secrets: the auth session goes to `SessionStorage`.
 * keys are namespaced by their owning module. storage content is untrusted:
 * readers parse stored values with Zod.
 */
export interface StorageAdapter {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}
