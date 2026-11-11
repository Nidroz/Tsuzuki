import { describe, expect, it, jest } from '@jest/globals';
import { act, waitFor } from '@testing-library/react';

import { entryOf } from '../../../test/core/library-entry-fixtures';
import {
  MEDIA,
  renderLibraryEntry,
  UNSTORABLE_MEDIA,
} from '../../../test/core/library-hooks-support';
import { LibraryRemoteError, LibrarySnapshotError } from '../errors/library-errors';
import { LIBRARY_ACTION_REPORT_SOURCE, LibraryActionError } from '../errors/library-report-errors';

// per R-04, the programming errors of the library actions reach the reporter as fixed errors, never
// with the caught error, a key or a value; the hook's error stays the caught one

const ENTRY = entryOf();
// above the known total of ENTRY (28): an invalid progress (BR-01)
const PROGRESS_ABOVE_TOTAL = 40;
const REPORT_CONTEXT = { source: LIBRARY_ACTION_REPORT_SOURCE };

type Rendered = ReturnType<typeof renderLibraryEntry>;

// runs an action and lets its write settle
const settleAction = async (action: () => void): Promise<void> => {
  await act(async () => {
    action();
    await jest.advanceTimersByTimeAsync(0);
  });
};

const renderLoaded = async (...args: Parameters<typeof renderLibraryEntry>): Promise<Rendered> => {
  const rendered = renderLibraryEntry(...args);
  await waitFor(() => {
    expect(rendered.result.current.entry.isSuccess).toBe(true);
  });
  return rendered;
};

// the reporter never received the error the hook shows
const expectCaughtErrorNotReported = (rendered: Rendered): void => {
  expect(rendered.result.current.actions.error).not.toBeNull();
  expect(rendered.captureError.mock.calls.flat()).not.toContain(
    rendered.result.current.actions.error,
  );
};

describe('useLibraryEntryActions: reports of programming errors (R-04)', () => {
  it('reports an action applied before its entry was loaded as entry-not-loaded', async () => {
    const rendered = renderLibraryEntry([ENTRY]);

    // the read still runs: the screen would not offer the action yet
    await settleAction(() => {
      rendered.result.current.actions.setScore(7);
    });

    expect(rendered.captureError.mock.calls).toStrictEqual([
      [new LibraryActionError('entry-not-loaded'), REPORT_CONTEXT],
    ]);
    expect(rendered.result.current.actions.error).toBeInstanceOf(LibraryActionError);
    expectCaughtErrorNotReported(rendered);
    expect(rendered.repository.save).not.toHaveBeenCalled();
  });

  it('reports a change a rule refused with a RangeError as invalid-change, the RangeError kept as the error', async () => {
    const rendered = await renderLoaded([ENTRY], MEDIA);

    await settleAction(() => {
      rendered.result.current.actions.setProgress(PROGRESS_ABOVE_TOTAL);
    });

    expect(rendered.captureError.mock.calls).toStrictEqual([
      [new LibraryActionError('invalid-change'), REPORT_CONTEXT],
    ]);
    expect(rendered.result.current.actions.error).toBeInstanceOf(RangeError);
    expectCaughtErrorNotReported(rendered);
  });

  it('reports a snapshot no library can hold as invalid-change', async () => {
    const rendered = renderLibraryEntry([], UNSTORABLE_MEDIA);
    await waitFor(() => {
      expect(rendered.result.current.entry.error).toBeInstanceOf(LibrarySnapshotError);
    });

    await settleAction(rendered.result.current.actions.toggleFavorite);

    expect(rendered.captureError.mock.calls).toStrictEqual([
      [new LibraryActionError('invalid-change'), REPORT_CONTEXT],
    ]);
    expect(rendered.result.current.actions.error).toBeInstanceOf(LibrarySnapshotError);
    expectCaughtErrorNotReported(rendered);
  });

  it.each([
    { failure: 'a full account library', error: new LibraryRemoteError('library-full') },
    { failure: 'a refused write', error: new LibraryRemoteError('rejected') },
    { failure: 'a storage failure', error: new RangeError('storage refused the document') },
  ])('reports nothing for $failure of the repository, shown as the error', async ({ error }) => {
    const rendered = await renderLoaded([ENTRY], MEDIA);
    rendered.repository.beforeCall.mockRejectedValueOnce(error);

    await settleAction(() => {
      rendered.result.current.actions.setScore(7);
    });

    expect(rendered.result.current.actions.error).toBe(error);
    expect(rendered.captureError).not.toHaveBeenCalled();
  });
});
