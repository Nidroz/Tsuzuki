import { describe, expect, it, jest } from '@jest/globals';
import { act, waitFor } from '@testing-library/react';

import { ENTRY_KEY, entryOf, entryWithMedia } from '../../../test/core/library-entry-fixtures';
import { PROGRESS_WRITE_COALESCE_MS } from '../domain/library-progress';
import {
  FRESH_MEDIA,
  FRESH_TOTAL,
  MEDIA,
  renderLibraryEntry,
  UNSTORABLE_MEDIA,
} from '../../../test/core/library-hooks-support';

const ENTRY = entryOf();
const PLANNED = entryOf({ status: 'planned', progress: 0, startedAt: null });
// the day of the fixed clock of the tests (test/core/fixed-clock.ts); waitFor moves the clock by
// milliseconds only, so the timestamps are compared, not spelled out
const TODAY = '2026-01-01';

type Rendered = ReturnType<typeof renderLibraryEntry>;

// the entry loaded, as the screen enables the actions only then
const renderLoaded = async (...args: Parameters<typeof renderLibraryEntry>): Promise<Rendered> => {
  const rendered = renderLibraryEntry(...args);
  await waitFor(() => {
    expect(rendered.result.current.entry.isSuccess).toBe(true);
  });
  return rendered;
};

// runs an action and lets its write settle
const settleAction = async (action: () => void): Promise<void> => {
  await act(async () => {
    action();
    await jest.advanceTimersByTimeAsync(0);
  });
};

describe('useLibraryEntryActions: add and remove (FR-10)', () => {
  it('adds the media as a planned entry with its catalog snapshot', async () => {
    const { result, repository } = await renderLoaded([], MEDIA);

    await settleAction(result.current.actions.add);

    expect(repository.stored(ENTRY_KEY)).toMatchObject({
      key: ENTRY_KEY,
      media: ENTRY.media,
      status: 'planned',
      progress: 0,
    });
    expect(repository.stored(ENTRY_KEY)?.createdAt).toBe(repository.stored(ENTRY_KEY)?.updatedAt);
    expect(result.current.entry.data).toStrictEqual(repository.stored(ENTRY_KEY));
  });

  it('adds nothing for a media already in the library', async () => {
    const { result, repository } = await renderLoaded([ENTRY], MEDIA);

    await settleAction(result.current.actions.add);

    expect(repository.save).not.toHaveBeenCalled();
    expect(result.current.actions.error).toBeNull();
  });

  it('fails an add without catalog data, or with data no snapshot can hold', async () => {
    const { result, rerender, repository } = await renderLoaded([], null);

    await settleAction(result.current.actions.add);

    expect(result.current.actions.error).toBeInstanceOf(Error);

    rerender({ media: UNSTORABLE_MEDIA });
    await settleAction(result.current.actions.add);

    expect(result.current.actions.error).toBeInstanceOf(RangeError);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('removes the entry, and does nothing when it is not in the library', async () => {
    const { result, repository } = await renderLoaded([ENTRY], MEDIA);

    await settleAction(result.current.actions.remove);
    await settleAction(result.current.actions.remove);

    expect(repository.remove).toHaveBeenCalledTimes(1);
    expect(repository.stored(ENTRY_KEY)).toBeNull();
    expect(result.current.entry.data).toBeNull();
  });
});

describe('useLibraryEntryActions: rules', () => {
  it('sets the status with BR-04: completed sets the progress to the total', async () => {
    const { result, repository } = await renderLoaded([ENTRY], MEDIA);

    await settleAction(() => {
      result.current.actions.setStatus('completed');
    });

    expect(repository.stored(ENTRY_KEY)).toMatchObject({
      status: 'completed',
      progress: ENTRY.media.totalUnits,
      finishedAt: TODAY,
    });
    expect(repository.stored(ENTRY_KEY)?.updatedAt).not.toBe(ENTRY.updatedAt);
  });

  it('sets the progress with BR-02: a planned entry becomes current', async () => {
    const { result, repository } = await renderLoaded([PLANNED], MEDIA);

    await settleAction(() => {
      result.current.actions.setProgress(3);
    });

    expect(repository.stored(ENTRY_KEY)).toMatchObject({
      status: 'current',
      progress: 3,
      startedAt: TODAY,
    });
  });

  it('writes rapid `+1` taps once, after the coalescing window (BR-09)', async () => {
    const { result, repository } = await renderLoaded([ENTRY], MEDIA);

    await act(async () => {
      result.current.actions.incrementProgress();
      result.current.actions.incrementProgress();
      result.current.actions.incrementProgress();
      await jest.advanceTimersByTimeAsync(PROGRESS_WRITE_COALESCE_MS - 1);
    });

    expect(result.current.entry.data?.progress).toBe(15);
    expect(repository.save).not.toHaveBeenCalled();

    await act(() => jest.advanceTimersByTimeAsync(1));

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.stored(ENTRY_KEY)?.progress).toBe(15);
  });

  it('writes coalesced `+1` taps once with BR-02 and BR-03, the tap past the total a no-op', async () => {
    const total = 2;
    const planned = entryWithMedia(
      { totalUnits: total },
      { status: 'planned', progress: 0, startedAt: null, finishedAt: null },
    );
    const { result, repository } = await renderLoaded([planned], { ...MEDIA, totalUnits: total });

    await act(async () => {
      result.current.actions.incrementProgress();
      result.current.actions.incrementProgress();
      result.current.actions.incrementProgress();
      await jest.advanceTimersByTimeAsync(PROGRESS_WRITE_COALESCE_MS);
    });

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.stored(ENTRY_KEY)).toMatchObject({
      status: 'completed',
      progress: total,
      startedAt: TODAY,
      finishedAt: TODAY,
    });
    expect(result.current.entry.data).toStrictEqual(repository.stored(ENTRY_KEY));
    expect(result.current.actions.error).toBeNull();
  });

  it('sets the score, and saves blank notes as no notes (BR-07)', async () => {
    const { result, repository } = await renderLoaded([ENTRY], MEDIA);

    await settleAction(() => {
      result.current.actions.setScore(null);
    });
    await settleAction(() => {
      result.current.actions.setNotes(' \n ');
    });

    expect(repository.stored(ENTRY_KEY)).toMatchObject({ score: null, notes: null });

    await settleAction(() => {
      result.current.actions.setNotes('  keep the indent');
    });

    expect(repository.stored(ENTRY_KEY)?.notes).toBe('  keep the indent');
  });

  it('keeps the stored snapshot without catalog data', async () => {
    const { result, repository } = await renderLoaded([ENTRY], null);

    await settleAction(() => {
      result.current.actions.setScore(7);
    });

    expect(repository.stored(ENTRY_KEY)).toMatchObject({ score: 7, media: ENTRY.media });
  });

  it('changes nothing for a media not in the library', async () => {
    const { result, repository } = await renderLoaded([], MEDIA);

    await settleAction(() => {
      result.current.actions.setStatus('completed');
      result.current.actions.incrementProgress();
    });
    await act(() => jest.advanceTimersByTimeAsync(PROGRESS_WRITE_COALESCE_MS));

    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('writes the catalog snapshot with an action, the fresh total included in the rule', async () => {
    // completed at the former total of 12, which the catalog now gives as FRESH_TOTAL
    const stale = entryWithMedia({ totalUnits: 12 }, { status: 'completed', progress: 12 });
    const { result, repository } = await renderLoaded([stale], FRESH_MEDIA);

    expect(repository.save).not.toHaveBeenCalled();

    await act(async () => {
      result.current.actions.incrementProgress();
      await jest.advanceTimersByTimeAsync(PROGRESS_WRITE_COALESCE_MS);
    });

    expect(repository.stored(ENTRY_KEY)).toMatchObject({
      progress: 13,
      media: { totalUnits: FRESH_TOTAL },
    });
  });
});
