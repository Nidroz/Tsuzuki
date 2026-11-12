// fixed errors the library hooks report in place of the error they caught (R-04): a device storage
// error could quote stored content (a title, a note), and a rule's RangeError names the change it
// refused. the message is fixed per kind and no cause is attached

/**
 * a device storage step of the library that failed: the removal of the merged entries from the
 * guest library after a successful merge (`guest-merge-cleanup`, ADR-0016 update of 2026-11-04),
 * the discard of the stuck writes (`stuck-writes-discard`, ADR-0017 update of 2026-11-04).
 */
export const LIBRARY_CLEANUP_STEPS = ['guest-merge-cleanup', 'stuck-writes-discard'] as const;

export type LibraryCleanupStep = (typeof LIBRARY_CLEANUP_STEPS)[number];

const LIBRARY_CLEANUP_MESSAGES: Readonly<Record<LibraryCleanupStep, string>> = {
  'guest-merge-cleanup': 'Library cleanup failed: guest merge',
  'stuck-writes-discard': 'Library cleanup failed: stuck writes discard',
};

/** a library storage step that failed; it holds the step only. */
export class LibraryCleanupError extends Error {
  readonly step: LibraryCleanupStep;

  constructor(step: LibraryCleanupStep) {
    super(LIBRARY_CLEANUP_MESSAGES[step]);
    this.name = 'LibraryCleanupError';
    this.step = step;
  }
}

/**
 * a programming error of a library action: an action applied before its entry was loaded
 * (`entry-not-loaded`), a change a business rule or the snapshot refused with a RangeError
 * (`invalid-change`). the user sees the action's error; the report tells a bug apart.
 */
export const LIBRARY_ACTION_PROBLEMS = ['entry-not-loaded', 'invalid-change'] as const;

export type LibraryActionProblem = (typeof LIBRARY_ACTION_PROBLEMS)[number];

const LIBRARY_ACTION_MESSAGES: Readonly<Record<LibraryActionProblem, string>> = {
  'entry-not-loaded': 'Library action applied before its entry was loaded',
  'invalid-change': 'Library action refused by a rule',
};

/** the report source of the library action programming errors. */
export const LIBRARY_ACTION_REPORT_SOURCE = 'library-action';

/** a library action programming error; it holds the problem only. */
export class LibraryActionError extends Error {
  readonly problem: LibraryActionProblem;

  constructor(problem: LibraryActionProblem) {
    super(LIBRARY_ACTION_MESSAGES[problem]);
    this.name = 'LibraryActionError';
    this.problem = problem;
  }
}
