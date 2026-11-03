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
