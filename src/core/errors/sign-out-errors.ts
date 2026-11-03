// errors of the sync of a sign out (FR-25, ADR-0018). each sync step that fails is reported with
// one of these: the message is fixed per step and no cause is attached, since a storage error could
// quote stored content

/**
 * the sync steps of a sign out, in their order: the flush of the live writer, the replay of the
 * queued writes.
 */
export const SIGN_OUT_SYNC_STEPS = ['flush', 'replay'] as const;

export type SignOutSyncStep = (typeof SIGN_OUT_SYNC_STEPS)[number];

const SIGN_OUT_SYNC_MESSAGES: Readonly<Record<SignOutSyncStep, string>> = {
  flush: 'Sign out sync failed: flush',
  replay: 'Sign out sync failed: replay',
};

/** a sync step of a sign out that failed; it holds the step only. */
export class SignOutSyncError extends Error {
  readonly step: SignOutSyncStep;

  constructor(step: SignOutSyncStep) {
    super(SIGN_OUT_SYNC_MESSAGES[step]);
    this.name = 'SignOutSyncError';
    this.step = step;
  }
}
