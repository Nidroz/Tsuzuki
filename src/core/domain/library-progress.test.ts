import { describe, expect, it } from '@jest/globals';

import { POSTGRES_INTEGER_MAX } from './database-limits';
import {
  createLibraryEntry,
  type LibraryEntry,
  type LibraryMediaSnapshot,
  type LibraryWriteContext,
} from './library-entry';
import {
  PROGRESS_MAX,
  PROGRESS_WRITE_COALESCE_MS,
  canIncrementProgress,
  incrementProgress,
  isValidProgress,
  progressMaxOf,
  setProgress,
  setStatus,
} from './library-progress';

const CREATED: LibraryWriteContext = { now: '2026-01-05T10:00:00.000Z', today: '2026-01-05' };
const CTX: LibraryWriteContext = { now: '2026-02-10T20:30:00.000Z', today: '2026-02-10' };
const EARLIER_DAY = '2026-01-20';

const TOTAL = 12;

// a library entry created at CREATED, with the given total and fields
const entryWith = (
  overrides: Partial<Omit<LibraryEntry, 'media'>> = {},
  totalUnits: number | null = TOTAL,
): LibraryEntry => {
  const media: LibraryMediaSnapshot = {
    title: 'Dungeon Meshi',
    imageUrl: null,
    format: 'tv',
    totalUnits,
    isAdult: false,
  };
  return {
    ...createLibraryEntry({ namespace: 'mal', kind: 'anime', externalId: 52701 }, media, CREATED),
    ...overrides,
  };
};

describe('BR-01 progressMaxOf', () => {
  it('is the total when known', () => {
    expect(progressMaxOf(TOTAL)).toBe(TOTAL);
  });

  it('is PROGRESS_MAX, the postgres integer bound, when the total is unknown', () => {
    expect(progressMaxOf(null)).toBe(PROGRESS_MAX);
    expect(PROGRESS_MAX).toBe(POSTGRES_INTEGER_MAX);
  });
});

describe('BR-01 isValidProgress', () => {
  it.each([0, 1, TOTAL])('accepts %p with a known total', (value) => {
    expect(isValidProgress(value, TOTAL)).toBe(true);
  });

  it.each([TOTAL + 1, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %p with a known total',
    (value) => {
      expect(isValidProgress(value, TOTAL)).toBe(false);
    },
  );

  it.each([0, 5000, PROGRESS_MAX])('accepts %p with an unknown total', (value) => {
    expect(isValidProgress(value, null)).toBe(true);
  });

  it.each([PROGRESS_MAX + 1, -1, 1.5, Number.NaN])('rejects %p with an unknown total', (value) => {
    expect(isValidProgress(value, null)).toBe(false);
  });
});

describe('BR-01 canIncrementProgress', () => {
  it('is true below the total and with an unknown total', () => {
    expect(canIncrementProgress(entryWith({ progress: TOTAL - 1 }))).toBe(true);
    expect(canIncrementProgress(entryWith({ progress: 400 }, null))).toBe(true);
  });

  it('is false at the total, above a dropped total and at PROGRESS_MAX', () => {
    expect(canIncrementProgress(entryWith({ progress: TOTAL }))).toBe(false);
    expect(canIncrementProgress(entryWith({ progress: TOTAL + 3 }))).toBe(false);
    expect(canIncrementProgress(entryWith({ progress: PROGRESS_MAX }, null))).toBe(false);
  });
});

describe('BR-01 setProgress validation', () => {
  it.each([TOTAL + 1, -1, 1.5, Number.NaN])('throws a RangeError on %p', (value) => {
    const entry = entryWith({ status: 'current', progress: 2 });
    expect(() => setProgress(entry, value, CTX)).toThrow(RangeError);
  });

  it('keeps the value out of the error message', () => {
    expect(() => setProgress(entryWith(), 987654, CTX)).toThrow(
      /^progress is outside the BR-01 range$/,
    );
  });

  it('is a no-op on an unchanged value above a dropped total', () => {
    const entry = entryWith({ status: 'current', progress: TOTAL + 3 });
    expect(setProgress(entry, TOTAL + 3, CTX)).toBe(entry);
  });

  it('lowers a progress above a dropped total to a valid value', () => {
    const entry = entryWith({ status: 'current', progress: TOTAL + 3 });
    expect(setProgress(entry, 4, CTX)).toStrictEqual({ ...entry, progress: 4, updatedAt: CTX.now });
  });
});

describe('BR-02 setProgress on a planned entry', () => {
  it('becomes current with startedAt today', () => {
    const entry = entryWith();
    expect(setProgress(entry, 3, CTX)).toStrictEqual({
      ...entry,
      status: 'current',
      progress: 3,
      startedAt: CTX.today,
      updatedAt: CTX.now,
    });
  });

  it('keeps an earlier startedAt', () => {
    const entry = entryWith({ startedAt: EARLIER_DAY, progress: 2 });
    const next = setProgress(entry, 3, CTX);
    expect(next.status).toBe('current');
    expect(next.startedAt).toBe(EARLIER_DAY);
  });

  it('counts a decrease as a change', () => {
    const next = setProgress(entryWith({ progress: 5 }), 4, CTX);
    expect(next.status).toBe('current');
    expect(next.startedAt).toBe(CTX.today);
  });

  it('leaves a non-planned status and its startedAt alone', () => {
    const entry = entryWith({ status: 'paused', progress: 2 });
    expect(setProgress(entry, 3, CTX)).toStrictEqual({ ...entry, progress: 3, updatedAt: CTX.now });
  });
});

describe('BR-03 setProgress reaching the total', () => {
  it.each(['current', 'paused', 'dropped'] as const)(
    'completes a %s entry with finishedAt today',
    (status) => {
      const entry = entryWith({ status, progress: TOTAL - 1, startedAt: EARLIER_DAY });
      expect(setProgress(entry, TOTAL, CTX)).toStrictEqual({
        ...entry,
        status: 'completed',
        progress: TOTAL,
        finishedAt: CTX.today,
        updatedAt: CTX.now,
      });
    },
  );

  it('applies after BR-02: a planned entry with total 1 taking +1 ends completed', () => {
    const entry = entryWith({}, 1);
    expect(incrementProgress(entry, CTX)).toStrictEqual({
      ...entry,
      status: 'completed',
      progress: 1,
      startedAt: CTX.today,
      finishedAt: CTX.today,
      updatedAt: CTX.now,
    });
  });

  it('overwrites finishedAt on every reach', () => {
    const entry = entryWith({ status: 'completed', progress: TOTAL - 2, finishedAt: EARLIER_DAY });
    expect(setProgress(entry, TOTAL, CTX).finishedAt).toBe(CTX.today);
  });

  it('keeps completed when decreasing from the total', () => {
    const entry = entryWith({ status: 'completed', progress: TOTAL, finishedAt: EARLIER_DAY });
    expect(setProgress(entry, TOTAL - 1, CTX)).toStrictEqual({
      ...entry,
      progress: TOTAL - 1,
      updatedAt: CTX.now,
    });
  });

  it('never completes with an unknown total', () => {
    const next = setProgress(entryWith({ status: 'current', progress: 99 }, null), 100, CTX);
    expect(next.status).toBe('current');
    expect(next.finishedAt).toBeNull();
  });
});

describe('BR-03 setStatus reverting from completed', () => {
  it.each(['current', 'paused', 'planned'] as const)(
    'keeps progress and dates when reverting to %s',
    (status) => {
      const entry = entryWith({
        status: 'completed',
        progress: TOTAL,
        startedAt: EARLIER_DAY,
        finishedAt: EARLIER_DAY,
      });
      expect(setStatus(entry, status, CTX)).toStrictEqual({ ...entry, status, updatedAt: CTX.now });
    },
  );
});

describe('BR-04 setStatus to completed', () => {
  it('sets progress to a known total from below, with finishedAt today', () => {
    const entry = entryWith({ status: 'current', progress: 3, startedAt: EARLIER_DAY });
    expect(setStatus(entry, 'completed', CTX)).toStrictEqual({
      ...entry,
      status: 'completed',
      progress: TOTAL,
      finishedAt: CTX.today,
      updatedAt: CTX.now,
    });
  });

  it('lowers a progress above a dropped total to the total', () => {
    const entry = entryWith({ status: 'current', progress: TOTAL + 3 });
    expect(setStatus(entry, 'completed', CTX).progress).toBe(TOTAL);
  });

  it('keeps the progress with an unknown total and still sets finishedAt', () => {
    const entry = entryWith({ status: 'current', progress: 40 }, null);
    expect(setStatus(entry, 'completed', CTX)).toStrictEqual({
      ...entry,
      status: 'completed',
      finishedAt: CTX.today,
      updatedAt: CTX.now,
    });
  });

  it('does not apply BR-02 to a planned entry', () => {
    expect(setStatus(entryWith(), 'completed', CTX).startedAt).toBeNull();
  });
});

describe('setStatus to current and other statuses', () => {
  it('sets startedAt today on current only when unset', () => {
    expect(setStatus(entryWith(), 'current', CTX).startedAt).toBe(CTX.today);
    const started = entryWith({ status: 'paused', startedAt: EARLIER_DAY });
    expect(setStatus(started, 'current', CTX).startedAt).toBe(EARLIER_DAY);
  });

  it('only changes the status on any other transition', () => {
    const entry = entryWith({ status: 'current', progress: 5, startedAt: EARLIER_DAY });
    expect(setStatus(entry, 'dropped', CTX)).toStrictEqual({
      ...entry,
      status: 'dropped',
      updatedAt: CTX.now,
    });
  });
});

describe('BR-09 write convention', () => {
  it('returns the same reference on every no-op', () => {
    const entry = entryWith({ status: 'current', progress: 4 });
    expect(setProgress(entry, 4, CTX)).toBe(entry);
    expect(setStatus(entry, 'current', CTX)).toBe(entry);
    const atTotal = entryWith({ status: 'completed', progress: TOTAL });
    expect(incrementProgress(atTotal, CTX)).toBe(atTotal);
    const aboveDroppedTotal = entryWith({ status: 'current', progress: TOTAL + 3 });
    expect(incrementProgress(aboveDroppedTotal, CTX)).toBe(aboveDroppedTotal);
  });

  it('stamps updatedAt = ctx.now on every change', () => {
    const entry = entryWith({ status: 'current', progress: 4 });
    expect(setProgress(entry, 6, CTX).updatedAt).toBe(CTX.now);
    expect(incrementProgress(entry, CTX).updatedAt).toBe(CTX.now);
    expect(setStatus(entry, 'paused', CTX).updatedAt).toBe(CTX.now);
  });

  it('coalesces N sequential +1 taps on a planned entry with total N into one completed state', () => {
    const taps = 3;
    const ctxAt = (tap: number): LibraryWriteContext => ({
      now: `2026-02-10T20:30:0${String(tap)}.000Z`,
      today: CTX.today,
    });
    let entry = entryWith({}, taps);
    for (let tap = 1; tap <= taps; tap += 1) {
      entry = incrementProgress(entry, ctxAt(tap));
    }
    expect(entry).toStrictEqual({
      ...entryWith({}, taps),
      status: 'completed',
      progress: taps,
      startedAt: CTX.today,
      finishedAt: CTX.today,
      updatedAt: ctxAt(taps).now,
    });
    expect(incrementProgress(entry, ctxAt(taps + 1))).toBe(entry);
  });

  it('coalesces taps within 500 ms', () => {
    expect(PROGRESS_WRITE_COALESCE_MS).toBe(500);
  });
});
