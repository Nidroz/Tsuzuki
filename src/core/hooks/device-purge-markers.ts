import {
  DevicePurgeMarkerOperationError,
  type DevicePurgeMarkerOperation,
  type DevicePurgeStep,
} from '../errors/device-purge-errors';
import type { ErrorReporter } from '../errors/error-reporter';
import type {
  DevicePurgeMarker,
  DevicePurgeMarkerRepository,
} from '../repositories/device-purge-marker-repository';

const REPORT_SOURCE = 'device-purge-marker';

const NO_MARKER: readonly DevicePurgeMarker[] = [];

/** the purge-pending markers as the hooks use them; never throws */
export interface DevicePurgeMarkers {
  /** the markers on the device; none when the read failed */
  list(): readonly DevicePurgeMarker[];
  /** writes `marker` in place of the marker of the same user */
  add(marker: DevicePurgeMarker): void;
  /** removes the marker of `userId`, if any */
  remove(userId: string): void;
  /**
   * after a device purge of `userId` resolved `failed`: the marker is removed when the
   * `account-library` step succeeded, else rewritten with `clearGuestLibrary` and `deviceWide`
   * false, so the next launch purges that user's documents again and nothing device-wide: the
   * device-wide steps have run once, and a retry must not clear guest entries or recent searches
   * added since (ADR-0018, update of 2026-11-04)
   */
  settle(userId: string, failed: readonly DevicePurgeStep[]): void;
}

/**
 * `markers` whose failures (a storage error, a user id that is not a uuid) are reported with a
 * fixed message and the operation as the only tag, never thrown: a marker is a safety net, its
 * failure never blocks a sign out or a purge
 */
export const guardDevicePurgeMarkers = (
  markers: DevicePurgeMarkerRepository,
  reporter: ErrorReporter,
): DevicePurgeMarkers => {
  const attempt = <T>(operation: DevicePurgeMarkerOperation, call: () => T, fallback: T): T => {
    try {
      return call();
    } catch {
      reporter.captureError(new DevicePurgeMarkerOperationError(operation), {
        source: REPORT_SOURCE,
        tags: { operation },
      });
      return fallback;
    }
  };
  const add = (marker: DevicePurgeMarker): void => {
    attempt(
      'add',
      () => {
        markers.add(marker);
      },
      undefined,
    );
  };
  const remove = (userId: string): void => {
    attempt(
      'remove',
      () => {
        markers.remove(userId);
      },
      undefined,
    );
  };
  return {
    list: () => attempt('list', () => markers.list(), NO_MARKER),
    add,
    remove,
    settle: (userId, failed) => {
      if (failed.includes('account-library')) {
        add({ userId, clearGuestLibrary: false, deviceWide: false });
      } else {
        remove(userId);
      }
    },
  };
};
