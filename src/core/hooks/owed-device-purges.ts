// the device purges a memory app storage owes to the files (R-09). while a process runs its app
// storage on memory (the key unavailable, the instance not opened), a sign out, an account
// deletion, a gone or a launch purge deletes that user's data from memory only: the files keep
// that user's copy and queue, the recent searches and the cache, with no marker, and the next
// launch that reads them would show them again. so each such purge first records its user in a
// store that lasts (the composition root passes a marker repository over the secure store), and
// the next launch on the files carries the records into the purge-pending markers, which
// DevicePurgeDriver applies with its usual rules (ADR-0018, update of 2026-11-04)
import type { ErrorReporter } from '../errors/error-reporter';
import type {
  DevicePurgeMarker,
  DevicePurgeMarkerRepository,
} from '../repositories/device-purge-marker-repository';
import { guardDevicePurgeMarkers, reportDevicePurgeMarkerFailure } from './device-purge-markers';

/** records the user of a device purge as owed to the files, before any step runs; never throws */
export type OweDevicePurge = (userId: string, deviceWide: boolean) => void;

/** the OweDevicePurge of a process whose app storage persists: its purges reach the files */
export const OWE_NO_DEVICE_PURGE: OweDevicePurge = () => undefined;

/**
 * the OweDevicePurge over `owed`: it records `{ userId, clearGuestLibrary: false, deviceWide }`,
 * `deviceWide` true when it was already owed for that user or this purge runs the device-wide
 * steps: a flag is never lowered. `clearGuestLibrary` is always false: the memory process merged
 * only its memory guest library, while the guest library of the files is as the last launch on
 * them left it, under its own rule, so a purge owed to the files never clears guest entries the
 * account may lack. a failure (the secure store, a user id that is not a uuid) is reported
 * (`owe`, no user id) and never thrown: the purge still runs on memory, and the report is all
 * that tells the files kept that user's data
 */
export const guardOwedDevicePurges =
  (owed: DevicePurgeMarkerRepository, reporter: ErrorReporter): OweDevicePurge =>
  (userId, deviceWide) => {
    try {
      const before = owed.list().find((marker) => marker.userId === userId);
      owed.add({
        userId,
        clearGuestLibrary: false,
        deviceWide: (before?.deviceWide ?? false) || deviceWide,
      });
    } catch {
      reportDevicePurgeMarkerFailure(reporter, 'owe');
    }
  };

export interface SettleOwedDevicePurgesInput {
  /** the owed purges, in the store that lasts while the app storage runs on memory */
  readonly owed: DevicePurgeMarkerRepository;
  /** the purge-pending markers of this process's app storage */
  readonly markers: DevicePurgeMarkerRepository;
  /** false while this process runs its app storage on memory (openAppStorage) */
  readonly persistent: boolean;
  /** no app storage file existed as this process started (openAppStorage) */
  readonly firstLaunch: boolean;
  readonly reporter: ErrorReporter;
}

// a new install, or an ios reinstall, whose secure store kept the records: the files they were
// owed to are gone. kept, they would make the next launch purge the new install's device-wide data
const discardOwedPurges = (owed: DevicePurgeMarkerRepository, reporter: ErrorReporter): void => {
  const guarded = guardDevicePurgeMarkers(owed, reporter);
  for (const { userId } of guarded.list()) {
    guarded.remove(userId);
  }
};

// each owed purge becomes a marker of the files, its flags merged with the marker already there
// (never lowered), then leaves the owed store. a failure keeps that owed purge for the next launch
const carryOwedPurges = (
  owed: DevicePurgeMarkerRepository,
  markers: DevicePurgeMarkerRepository,
  reporter: ErrorReporter,
): void => {
  let owedPurges: readonly DevicePurgeMarker[];
  let marked: readonly DevicePurgeMarker[];
  try {
    owedPurges = owed.list();
    if (owedPurges.length === 0) {
      return;
    }
    marked = markers.list();
  } catch {
    reportDevicePurgeMarkerFailure(reporter, 'carry');
    return;
  }
  for (const { userId, deviceWide } of owedPurges) {
    const existing = marked.find((marker) => marker.userId === userId);
    try {
      markers.add({
        userId,
        clearGuestLibrary: existing?.clearGuestLibrary ?? false,
        deviceWide: (existing?.deviceWide ?? false) || deviceWide,
      });
      owed.remove(userId);
    } catch {
      reportDevicePurgeMarkerFailure(reporter, 'carry');
    }
  }
};

/**
 * settles the purges an earlier memory process owed, once per process, before DevicePurgeDriver
 * lists the markers (the composition root calls it at module level, before the tree mounts):
 *
 * - `firstLaunch`: every owed purge is removed, whatever `persistent`: the files are new;
 * - `persistent` and not a first launch: each owed purge is carried into `markers`
 *   (`clearGuestLibrary` the existing marker's or false, `deviceWide` the existing marker's or the
 *   owed one), then removed from `owed`; a failure is reported (`carry`, or `list` and `remove`
 *   for the discard) and that owed purge is kept for the next launch;
 * - on memory, not a first launch: nothing is touched, the files cannot be reached.
 *
 * the driver then purges a carried user unless they are the session's user, the device-wide
 * steps only when no other user is signed in. that purge also deletes that user's queued writes
 * left in the files by an earlier launch, which the memory process could neither see nor count:
 * the user asked for the sign out or the deletion, and keeping notes at rest on a device that may
 * be handed over is what ADR-0018 refuses. a damaged owed document reads as no owed purge (its
 * repository reports it); never throws
 */
export const settleOwedDevicePurges = ({
  owed,
  markers,
  persistent,
  firstLaunch,
  reporter,
}: SettleOwedDevicePurgesInput): void => {
  if (firstLaunch) {
    discardOwedPurges(owed, reporter);
  } else if (persistent) {
    carryOwedPurges(owed, markers, reporter);
  }
};
