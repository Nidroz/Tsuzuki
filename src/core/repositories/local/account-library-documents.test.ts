import { describe, expect, it } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import type { LibraryQueuedWrite } from '../../domain/library-sync';
import { USER_A } from './__fixtures__/in-memory-remote';
import {
  accountLibraryStorageKeys,
  readAccountCopy,
  readAccountQueue,
  serializeAccountCopy,
  serializeAccountQueue,
} from './account-library-documents';

// the two documents of the offline account library (ADR-0017): untrusted, parsed on every read,
// a damaged part dropped and returned as a problem, never thrown

const OLDER = '2026-02-01T00:00:00.000Z';
const NEWER = '2026-02-02T00:00:00.000Z';
const OTHER_KEY = keyOf('manga', 8);

const save = (updatedAt = NEWER): LibraryQueuedWrite => ({
  type: 'save',
  entry: entryOf({ updatedAt }),
});
const removal: LibraryQueuedWrite = { type: 'remove', key: OTHER_KEY, removedAt: OLDER };

const queueDocument = (nextSeq: number, writes: readonly unknown[]): string =>
  JSON.stringify({ version: 1, nextSeq, writes });

describe('accountLibraryStorageKeys', () => {
  it('builds both keys from the user id', () => {
    expect(accountLibraryStorageKeys(USER_A)).toStrictEqual({
      copy: `account-library-copy.${USER_A}`,
      queue: `account-library-queue.${USER_A}`,
    });
  });

  it.each(['', 'user-42', `${USER_A}.x`, '../guest-library'])(
    'rejects a user id that is not a uuid (%j) with a RangeError holding no value',
    (userId) => {
      expect(() => accountLibraryStorageKeys(userId)).toThrow(
        new RangeError('account library user id is not a uuid'),
      );
    },
  );
});

describe('readAccountCopy', () => {
  it('reads no copy when nothing is stored', () => {
    expect(readAccountCopy(undefined)).toStrictEqual({ value: null, problems: new Set() });
  });

  it('reads an empty copy as a copy without entries', () => {
    expect(readAccountCopy(serializeAccountCopy([])).value).toStrictEqual([]);
  });

  it.each([
    { label: 'not json', stored: '{', reason: 'invalid-json' },
    { label: 'another version', stored: '{"version":2,"entries":[]}', reason: 'invalid-envelope' },
  ])('reads a document that is $label as no copy, never as an empty one', ({ stored, reason }) => {
    expect(readAccountCopy(stored)).toStrictEqual({ value: null, problems: new Set([reason]) });
  });

  it('drops an invalid entry and keeps the most recent entry of a key', () => {
    const older = entryOf({ updatedAt: OLDER });
    const newer = entryOf({ updatedAt: NEWER });
    const stored = JSON.stringify({ version: 1, entries: [older, { key: 1 }, newer] });

    expect(readAccountCopy(stored)).toStrictEqual({
      value: [newer],
      problems: new Set(['invalid-entries', 'duplicate-keys']),
    });
  });
});

describe('readAccountQueue', () => {
  it('reads an empty queue starting at seq 1 when nothing is stored', () => {
    expect(readAccountQueue(undefined).value).toStrictEqual({ nextSeq: 1, records: [] });
  });

  it('round trips the queue, its records by ascending seq', () => {
    const records = [
      { seq: 4, write: removal },
      { seq: 2, write: save() },
    ];

    expect(readAccountQueue(serializeAccountQueue({ nextSeq: 5, records }))).toStrictEqual({
      value: { nextSeq: 5, records: [records[1], records[0]] },
      problems: new Set(),
    });
  });

  it.each([
    { label: 'not json', stored: 'queue', reason: 'invalid-json' },
    {
      label: 'without its next seq',
      stored: '{"version":1,"writes":[]}',
      reason: 'invalid-envelope',
    },
    {
      label: 'of another version',
      stored: queueDocument(1, []).replace('1', '2'),
      reason: 'invalid-envelope',
    },
  ])('reads a document $label as an empty queue', ({ stored, reason }) => {
    expect(readAccountQueue(stored)).toStrictEqual({
      value: { nextSeq: 1, records: [] },
      problems: new Set([reason]),
    });
  });

  it('drops a record whose seq or write is invalid', () => {
    const stored = queueDocument(9, [
      { seq: 0, write: removal },
      { seq: 1.5, write: removal },
      { seq: 2, write: { type: 'save', entry: { ...entryOf(), progress: -1 } } },
      { seq: 3, write: { type: 'remove', key: OTHER_KEY, removedAt: 'yesterday' } },
      { seq: 4, write: removal },
    ]);

    expect(readAccountQueue(stored)).toStrictEqual({
      value: { nextSeq: 9, records: [{ seq: 4, write: removal }] },
      problems: new Set(['invalid-entries']),
    });
  });

  it('keeps the higher seq of two writes of one key, and a next seq above every seq', () => {
    const stored = queueDocument(2, [
      { seq: 7, write: save(NEWER) },
      { seq: 3, write: save(OLDER) },
    ]);

    expect(readAccountQueue(stored)).toStrictEqual({
      value: { nextSeq: 8, records: [{ seq: 7, write: save(NEWER) }] },
      problems: new Set(['duplicate-keys']),
    });
  });

  it('normalizes the times of a write and strips unknown fields', () => {
    const stored = queueDocument(2, [
      { seq: 1, write: { ...removal, removedAt: '2026-02-01T01:00:00+01:00', extra: true } },
    ]);

    expect(readAccountQueue(stored).value.records).toStrictEqual([{ seq: 1, write: removal }]);
  });
});
