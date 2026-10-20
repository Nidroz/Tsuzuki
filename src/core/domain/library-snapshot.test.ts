import { describe, expect, it } from '@jest/globals';

import {
  ENTRY_UPDATED_AT,
  SNAPSHOT,
  entryOf,
  entryWithMedia,
} from '../../../test/core/library-entry-fixtures';
import type { LibraryMediaSnapshot, LibraryWriteContext } from './library-entry';
import { canIncrementProgress } from './library-progress';
import { isSameMediaSnapshot, refreshMediaSnapshot, withMediaSnapshot } from './library-snapshot';

const CTX: LibraryWriteContext = { now: '2026-03-01T08:15:00.000Z', today: '2026-03-01' };

describe('isSameMediaSnapshot', () => {
  it('is true for an equal copy', () => {
    expect(isSameMediaSnapshot(SNAPSHOT, { ...SNAPSHOT })).toBe(true);
  });

  it.each<[string, Partial<LibraryMediaSnapshot>]>([
    ['title', { title: 'Frieren' }],
    ['imageUrl', { imageUrl: null }],
    ['format', { format: 'movie' }],
    ['totalUnits', { totalUnits: null }],
    ['isAdult', { isAdult: true }],
  ])('is false when %s differs', (_field, change) => {
    expect(isSameMediaSnapshot(SNAPSHOT, { ...SNAPSHOT, ...change })).toBe(false);
  });
});

describe('BR-09 refreshMediaSnapshot', () => {
  it('is a no-op (the same reference) when the snapshot is the same', () => {
    const entry = entryOf();
    expect(refreshMediaSnapshot(entry, { ...SNAPSHOT }, CTX)).toBe(entry);
  });

  it('writes a new snapshot with updatedAt = ctx.now', () => {
    const entry = entryOf();
    const media: LibraryMediaSnapshot = { ...SNAPSHOT, title: 'Frieren', totalUnits: 30 };
    expect(refreshMediaSnapshot(entry, media, CTX)).toStrictEqual({
      ...entry,
      media,
      updatedAt: CTX.now,
    });
  });

  it('keeps the progress when the total drops below it', () => {
    const entry = entryOf({ progress: 20 });
    const next = refreshMediaSnapshot(entry, { ...SNAPSHOT, totalUnits: 12 }, CTX);
    expect(next.progress).toBe(20);
    expect(next.status).toBe('current');
    expect(canIncrementProgress(next)).toBe(false);
  });

  it('does not complete the entry when the total drops to the progress (BR-03)', () => {
    const entry = entryOf({ progress: 12 });
    const next = refreshMediaSnapshot(entry, { ...SNAPSHOT, totalUnits: 12 }, CTX);
    expect(next).toStrictEqual({
      ...entry,
      media: { ...SNAPSHOT, totalUnits: 12 },
      updatedAt: CTX.now,
    });
  });

  it('never touches the status, progress or dates', () => {
    const entry = entryWithMedia(
      { totalUnits: null },
      { status: 'completed', progress: 40, startedAt: '2026-01-06', finishedAt: '2026-02-01' },
    );
    const next = refreshMediaSnapshot(entry, { ...SNAPSHOT, totalUnits: 28 }, CTX);
    expect(next).toMatchObject({
      status: 'completed',
      progress: 40,
      startedAt: '2026-01-06',
      finishedAt: '2026-02-01',
    });
  });
});

describe('withMediaSnapshot', () => {
  it('is the same reference when the snapshot is the same', () => {
    const entry = entryOf();
    expect(withMediaSnapshot(entry, { ...SNAPSHOT })).toBe(entry);
  });

  it('shows a fresher snapshot with updatedAt unchanged', () => {
    const entry = entryWithMedia({ totalUnits: null }, { progress: 12 });
    const next = withMediaSnapshot(entry, SNAPSHOT);
    expect(next).toStrictEqual({ ...entry, media: SNAPSHOT });
    expect(next.updatedAt).toBe(ENTRY_UPDATED_AT);
  });

  it('enables +1 with the current total of the provider', () => {
    const entry = entryWithMedia({ totalUnits: 12 }, { progress: 12 });
    expect(canIncrementProgress(entry)).toBe(false);
    expect(canIncrementProgress(withMediaSnapshot(entry, SNAPSHOT))).toBe(true);
  });
});
