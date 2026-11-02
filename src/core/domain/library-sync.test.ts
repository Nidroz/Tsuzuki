import { describe, expect, it } from '@jest/globals';

import { entryOf, keyOf } from '../../../test/core/library-entry-fixtures';
import { guestMergeDecision } from './guest-merge';
import {
  LIBRARY_REPLAY_BATCH_SIZE,
  LIBRARY_REPLAY_OUTCOMES,
  libraryQueuedWriteKey,
  libraryQueuedWriteTime,
  overlayQueuedWrites,
  queuedWriteTime,
  replayRemovalOutcome,
  type LibraryQueuedWrite,
} from './library-sync';

const KNOWN = '2026-02-10T20:30:00.123Z';
const OTHER_KEY = keyOf('manga', 8);
const THIRD_KEY = keyOf('anime', 3);

describe('library sync constants', () => {
  it('sends at most 100 writes per replay call and answers written or kept', () => {
    expect(LIBRARY_REPLAY_BATCH_SIZE).toBe(100);
    expect(LIBRARY_REPLAY_OUTCOMES).toStrictEqual(['written', 'kept']);
  });
});

describe('queuedWriteTime', () => {
  it('keeps the change time when no state of the key is known', () => {
    expect(queuedWriteTime('2026-01-01T00:00:00.000Z', null)).toBe('2026-01-01T00:00:00.000Z');
  });

  it('keeps the change time when it is later than the known state', () => {
    expect(queuedWriteTime('2026-02-11T08:00:00.000Z', KNOWN)).toBe('2026-02-11T08:00:00.000Z');
  });

  // a device clock behind the server: the change would lose to the copy it replaced
  it('times a change earlier than the known state one millisecond after it', () => {
    expect(queuedWriteTime('2026-02-01T00:00:00.000Z', KNOWN)).toBe('2026-02-10T20:30:00.124Z');
  });

  it('times a change equal to the known state one millisecond after it', () => {
    expect(queuedWriteTime(KNOWN, KNOWN)).toBe('2026-02-10T20:30:00.124Z');
  });

  it('carries over a second, a day and a year boundary', () => {
    expect(queuedWriteTime('2020-01-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z')).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  // across devices (BR-08): the replayed change wins over the state it was computed from
  it('gives a change a time that wins over the state it was computed from', () => {
    const time = queuedWriteTime('2026-02-01T00:00:00.000Z', KNOWN);

    expect(guestMergeDecision(time, KNOWN)).toBe('replace');
    expect(replayRemovalOutcome(time, KNOWN)).toBe('written');
  });
});

describe('libraryQueuedWriteKey and libraryQueuedWriteTime', () => {
  it('reads the key and the time of a save from its entry', () => {
    const write: LibraryQueuedWrite = { type: 'save', entry: entryOf({ key: OTHER_KEY }) };

    expect(libraryQueuedWriteKey(write)).toBe(OTHER_KEY);
    expect(libraryQueuedWriteTime(write)).toBe(entryOf().updatedAt);
  });

  it('reads the key and the time of a removal', () => {
    const write: LibraryQueuedWrite = { type: 'remove', key: OTHER_KEY, removedAt: KNOWN };

    expect(libraryQueuedWriteKey(write)).toBe(OTHER_KEY);
    expect(libraryQueuedWriteTime(write)).toBe(KNOWN);
  });
});

describe('BR-08 replayRemovalOutcome', () => {
  it('is written when the account holds no entry of the key', () => {
    expect(replayRemovalOutcome(KNOWN, null)).toBe('written');
  });

  it('is written when the stored entry is strictly older', () => {
    expect(replayRemovalOutcome(KNOWN, '2026-02-10T20:30:00.122Z')).toBe('written');
  });

  it('keeps a stored entry with the same time', () => {
    expect(replayRemovalOutcome(KNOWN, KNOWN)).toBe('kept');
  });

  it('keeps a newer stored entry (a change made on another device after the removal)', () => {
    expect(replayRemovalOutcome(KNOWN, '2026-02-10T20:30:00.124Z')).toBe('kept');
  });
});

describe('overlayQueuedWrites', () => {
  const stored = entryOf({ progress: 3, updatedAt: '2026-02-01T00:00:00.000Z' });
  const other = entryOf({ key: OTHER_KEY, updatedAt: '2026-02-05T00:00:00.000Z' });

  it('replaces the entry of a queued save and moves it to its list place', () => {
    const queued = entryOf({ progress: 4, updatedAt: '2026-02-09T00:00:00.000Z' });

    expect(overlayQueuedWrites([other, stored], [{ type: 'save', entry: queued }])).toStrictEqual([
      queued,
      other,
    ]);
  });

  it('adds the entry of a queued save of a key not listed', () => {
    const added = entryOf({ key: THIRD_KEY, updatedAt: '2026-02-03T00:00:00.000Z' });

    expect(overlayQueuedWrites([other, stored], [{ type: 'save', entry: added }])).toStrictEqual([
      other,
      added,
      stored,
    ]);
  });

  it('drops the key of a queued removal, and ignores the removal of a key not listed', () => {
    const writes: LibraryQueuedWrite[] = [
      { type: 'remove', key: stored.key, removedAt: KNOWN },
      { type: 'remove', key: THIRD_KEY, removedAt: KNOWN },
    ];

    expect(overlayQueuedWrites([other, stored], writes)).toStrictEqual([other]);
  });

  it('orders equal times by the key ascending, as the repositories list', () => {
    const time = '2026-02-07T00:00:00.000Z';
    const manga = entryOf({ key: OTHER_KEY, updatedAt: time });
    const anime = entryOf({ key: THIRD_KEY, updatedAt: time });

    expect(overlayQueuedWrites([manga], [{ type: 'save', entry: anime }])).toStrictEqual([
      anime,
      manga,
    ]);
  });

  it('returns the entries in list order without a queued write, mutating nothing', () => {
    const entries = Object.freeze([stored, other]);
    const writes: readonly LibraryQueuedWrite[] = Object.freeze([]);

    expect(overlayQueuedWrites(entries, writes)).toStrictEqual([other, stored]);
    expect(entries).toStrictEqual([stored, other]);
  });
});
