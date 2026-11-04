// errors of the device purge of a sign out or an account deletion (FR-24, FR-25, ADR-0018). each
// purge step that fails is reported with one of these and the next steps still run: the message
// is fixed per step and no cause is attached, since a storage or cache error could quote stored
// content

/**
 * the steps of the device purge, in their order: the user's library copy and write queue, the
 * guest library, the recent searches, the query cache, the persisted query cache document.
 */
export const DEVICE_PURGE_STEPS = [
  'account-library',
  'guest-library',
  'recent-searches',
  'query-cache',
  'persisted-cache',
] as const;

export type DevicePurgeStep = (typeof DEVICE_PURGE_STEPS)[number];

const DEVICE_PURGE_MESSAGES: Readonly<Record<DevicePurgeStep, string>> = {
  'account-library': 'Device purge failed: account library',
  'guest-library': 'Device purge failed: guest library',
  'recent-searches': 'Device purge failed: recent searches',
  'query-cache': 'Device purge failed: query cache',
  'persisted-cache': 'Device purge failed: persisted cache',
};

/** a purge step that failed; it holds the step only. */
export class DevicePurgeError extends Error {
  readonly step: DevicePurgeStep;

  constructor(step: DevicePurgeStep) {
    super(DEVICE_PURGE_MESSAGES[step]);
    this.name = 'DevicePurgeError';
    this.step = step;
  }
}

/**
 * why the purge-pending marker document (ADR-0018, update of 2026-11-04) could not be read whole:
 * the stored text is not json, the json is not a version 1 envelope, some markers failed their
 * schema and were dropped, or several markers named the same user and only one was kept.
 */
export const DEVICE_PURGE_MARKER_PROBLEMS = [
  'invalid-json',
  'invalid-envelope',
  'invalid-markers',
  'duplicate-users',
] as const;

export type DevicePurgeMarkerProblem = (typeof DEVICE_PURGE_MARKER_PROBLEMS)[number];

/**
 * the purge-pending marker document is damaged; reported, never thrown on read. it holds the
 * problem only: never a user id or stored content, and no cause is attached.
 */
export class DevicePurgeMarkerError extends Error {
  readonly problem: DevicePurgeMarkerProblem;

  constructor(problem: DevicePurgeMarkerProblem) {
    super(`Device purge marker is damaged: ${problem}`);
    this.name = 'DevicePurgeMarkerError';
    this.problem = problem;
  }
}
