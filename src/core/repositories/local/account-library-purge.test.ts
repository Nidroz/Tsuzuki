import { describe, expect, it, jest } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import type { LibraryEntry } from '../../domain/library-entry';
import type { MediaKey } from '../../domain/media';
import { USER_A, USER_B, setupOfflineLibraries } from './__fixtures__/in-memory-remote';
import { createMemoryStorage } from './__fixtures__/memory-storage';

// the device purge of the offline account library (ADR-0018 "Device purge"): the queued write
// count, the deletion of exactly one user's documents, the instances closed by it, and the next
// instance of that user starting afresh

const KEY_1 = keyOf('anime', 1);
const KEY_2 = keyOf('anime', 2);
const KEY_3 = keyOf('anime', 3);
const copyKeyOf = (userId: string): string => `account-library-copy.${userId}`;
const queueKeyOf = (userId: string): string => `account-library-queue.${userId}`;
const documentsOf = (userId: string): string[] => [copyKeyOf(userId), queueKeyOf(userId)];

const entryAt = (key: MediaKey, progress = 1): LibraryEntry =>
  entryOf({
    key,
    progress,
    createdAt: '2025-12-01T00:00:00.000Z',
    updatedAt: '2025-12-31T00:00:00.000Z',
  });

const SIGNED_OUT = { name: 'LibraryRemoteError', reason: 'signed-out' };

// a factory where `userId` has a device copy (one listed entry) and one write queued offline
const setupWithDocuments = async (storage = createMemoryStorage()) => {
  const offline = setupOfflineLibraries({ storage });
  for (const userId of [USER_A, USER_B]) {
    offline.remoteOf(userId).seed(entryAt(KEY_1));
    const library = offline.libraryFor(userId);
    await library.list();
    offline.connectivity.online = false;
    await library.save(entryAt(KEY_2));
    offline.connectivity.online = true;
  }
  return offline;
};

describe('queuedWriteCount', () => {
  it('counts the writes queued, shared by the instances of the user only', async () => {
    const offline = setupOfflineLibraries();
    const library = offline.libraryFor(USER_A);
    expect(library.queuedWriteCount()).toBe(0);
    offline.connectivity.online = false;

    await library.save(entryAt(KEY_1));
    await library.save(entryAt(KEY_1, 2));
    await library.remove(KEY_2);

    expect(library.queuedWriteCount()).toBe(2);
    expect(offline.libraryFor(USER_A).queuedWriteCount()).toBe(2);
    expect(offline.libraryFor(USER_B).queuedWriteCount()).toBe(0);
  });

  it('counts a write in flight until the server confirmed it', async () => {
    const offline = setupOfflineLibraries();
    const library = offline.libraryFor(USER_A);
    const gate = offline.remoteOf(USER_A).holdNext('save');

    const saving = library.save(entryAt(KEY_1));
    expect(library.queuedWriteCount()).toBe(1);
    gate.open();
    await saving;

    expect(library.queuedWriteCount()).toBe(0);
  });

  it('keeps counting a write the replay refused, not one a direct attempt saw refused', async () => {
    const offline = setupOfflineLibraries();
    const library = offline.libraryFor(USER_A);
    const remote = offline.remoteOf(USER_A);
    offline.connectivity.online = false;
    await library.save(entryAt(KEY_1));
    offline.connectivity.online = true;
    remote.refuseKey(KEY_1);
    remote.failNext('save', 'rejected');

    await expect(library.replayQueuedWrites()).resolves.toMatchObject({ status: 'done' });
    await expect(library.save(entryAt(KEY_3))).rejects.toMatchObject({ reason: 'rejected' });

    expect(library.queuedWriteCount()).toBe(1);
  });
});

describe('purgeDeviceData', () => {
  it("deletes the user's copy and queue, sending nothing and leaving another user's", async () => {
    const offline = await setupWithDocuments();
    const others = documentsOf(USER_B).map((key) => offline.storage.values.get(key));
    const calls = offline.remoteOf(USER_A).calls.length;
    const library = offline.libraryFor(USER_A);

    library.purgeDeviceData();

    for (const key of documentsOf(USER_A)) {
      expect(offline.storage.values.has(key)).toBe(false);
    }
    expect(documentsOf(USER_B).map((key) => offline.storage.values.get(key))).toStrictEqual(others);
    expect(others).not.toContain(undefined);
    expect(offline.remoteOf(USER_A).calls).toHaveLength(calls);
    expect(offline.libraryFor(USER_B).queuedWriteCount()).toBe(1);
  });

  it('closes every instance created before: calls reject signed-out and touch nothing', async () => {
    const offline = await setupWithDocuments();
    const retired = offline.libraryFor(USER_A);
    const library = offline.libraryFor(USER_A);
    const remote = offline.remoteOf(USER_A);
    const calls = remote.calls.length;

    library.purgeDeviceData();

    await expect(retired.save(entryAt(KEY_3))).rejects.toMatchObject(SIGNED_OUT);
    await expect(retired.remove(KEY_1)).rejects.toMatchObject(SIGNED_OUT);
    await expect(retired.list()).rejects.toMatchObject(SIGNED_OUT);
    await expect(retired.get(KEY_1)).rejects.toMatchObject(SIGNED_OUT);
    await expect(library.mergeGuestEntries([entryAt(KEY_3)])).rejects.toMatchObject(SIGNED_OUT);
    await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
      status: 'signed-out',
      confirmed: 0,
    });
    expect(retired.queuedWriteCount()).toBe(0);
    expect(documentsOf(USER_A).filter((key) => offline.storage.values.has(key))).toStrictEqual([]);
    expect(remote.calls).toHaveLength(calls);
    expect(remote.mergeGuestEntries).not.toHaveBeenCalled();
  });

  it('refuses a late write offline too, never queueing it', async () => {
    const offline = await setupWithDocuments();
    const retired = offline.libraryFor(USER_A);
    retired.purgeDeviceData();
    offline.connectivity.online = false;

    await expect(retired.save(entryAt(KEY_3))).rejects.toMatchObject(SIGNED_OUT);

    expect(offline.storage.values.has(queueKeyOf(USER_A))).toBe(false);
  });

  it('drops the listeners: no instance created before is notified again', async () => {
    const offline = setupOfflineLibraries();
    const retired = offline.libraryFor(USER_A);
    const before = jest.fn();
    retired.subscribeToQueuedWrites(before);
    retired.purgeDeviceData();
    const after = jest.fn();
    const unsubscribe = retired.subscribeToQueuedWrites(after);
    const next = offline.libraryFor(USER_A);
    const current = jest.fn();
    next.subscribeToQueuedWrites(current);
    offline.connectivity.online = false;

    await next.save(entryAt(KEY_1));
    unsubscribe();

    expect(current).toHaveBeenCalledTimes(1);
    expect(before).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it('gives the next instance of the user a fresh start: no copy, an empty queue', async () => {
    const offline = await setupWithDocuments();
    offline.libraryFor(USER_A).purgeDeviceData();
    const next = offline.libraryFor(USER_A);
    offline.connectivity.online = false;

    expect(next.queuedWriteCount()).toBe(0);
    await expect(next.list()).rejects.toMatchObject({ reason: 'network' });
    offline.connectivity.online = true;
    await expect(next.list()).resolves.toStrictEqual([entryAt(KEY_1)]);
    offline.connectivity.online = false;
    await next.save(entryAt(KEY_3));

    expect(next.queuedWriteCount()).toBe(1);
    await expect(next.list()).resolves.toHaveLength(2);
  });

  it("never deletes a later instance's documents when called again on a closed one", async () => {
    const offline = await setupWithDocuments();
    const retired = offline.libraryFor(USER_A);
    retired.purgeDeviceData();
    const next = offline.libraryFor(USER_A);
    await next.list();
    offline.connectivity.online = false;
    await next.save(entryAt(KEY_3));
    const documents = documentsOf(USER_A).map((key) => offline.storage.values.get(key));

    retired.purgeDeviceData();

    expect(documentsOf(USER_A).map((key) => offline.storage.values.get(key))).toStrictEqual(
      documents,
    );
    expect(documents).not.toContain(undefined);
    expect(next.queuedWriteCount()).toBe(1);
  });

  it('tries both deletions when the storage fails, then throws, the instance staying closed', async () => {
    const storage = createMemoryStorage();
    const failure = new Error('storage failed');
    const offline = await setupWithDocuments(storage);
    const library = offline.libraryFor(USER_A);
    storage.delete = (key) => {
      if (key === copyKeyOf(USER_A)) {
        throw failure;
      }
      storage.values.delete(key);
    };

    expect(() => {
      library.purgeDeviceData();
    }).toThrow(failure);

    expect(storage.values.has(queueKeyOf(USER_A))).toBe(false);
    await expect(library.list()).rejects.toMatchObject(SIGNED_OUT);
    expect(offline.libraryFor(USER_A).queuedWriteCount()).toBe(0);
  });
});
