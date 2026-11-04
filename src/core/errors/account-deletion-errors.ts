// errors of the account deletion (FR-24, ADR-0018). they reach the delete account screen, which
// translates the reason, and the error reporter for `unknown`: the message is fixed per reason and
// never holds a token, a user id or a server text, and no cause is attached

/**
 * why the account could not be deleted, and what the user can do: the device is offline, nothing
 * sent (`offline`, set by the hook: connect and retry); no answer came, or a gateway or rate limit
 * status, so the account may or may not be deleted (`network`: retry); there is no session on the
 * device, or the server refused its token (`session-expired`: sign in again); anything else
 * (`unknown`: retry later).
 */
export const ACCOUNT_DELETION_ERROR_REASONS = [
  'offline',
  'network',
  'session-expired',
  'unknown',
] as const;

export type AccountDeletionErrorReason = (typeof ACCOUNT_DELETION_ERROR_REASONS)[number];

const ACCOUNT_DELETION_ERROR_MESSAGES: Readonly<Record<AccountDeletionErrorReason, string>> = {
  offline: 'Account deletion needs a connection',
  network: 'Account deletion service unreachable',
  'session-expired': 'Account deletion needs a valid session',
  unknown: 'Account deletion failed',
};

/** a failed account deletion; it holds the reason only. */
export class AccountDeletionError extends Error {
  readonly reason: AccountDeletionErrorReason;

  constructor(reason: AccountDeletionErrorReason) {
    super(ACCOUNT_DELETION_ERROR_MESSAGES[reason]);
    this.name = 'AccountDeletionError';
    this.reason = reason;
  }
}

/** whether `error` is an AccountDeletionError of this module (screens read anything else as `unknown`). */
export const isAccountDeletionError = (error: unknown): error is AccountDeletionError =>
  error instanceof AccountDeletionError;
