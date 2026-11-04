// the purge-pending marker (ADR-0018, update of 2026-11-04): which users still owe a device purge,
// so a sign out, or a user gone, whose purge did not complete (the app killed, the
// `account-library` step failed) is purged again at the next launch. types and contracts only;
// the implementation lives in local/device-purge-marker-repository.ts, the composition root wires
// it, and the hooks decide when to write, purge and remove

/**
 * a user whose device purge is owed: the user id (already part of the per-user storage keys),
 * whether that purge clears the guest library, and whether the device-wide steps (guest library,
 * recent searches, caches) are still owed. nothing else is kept.
 */
export interface DevicePurgeMarker {
  readonly userId: string;
  readonly clearGuestLibrary: boolean;
  readonly deviceWide: boolean;
}

/**
 * the markers on this device, synchronous like the app storage. it decides nothing about purging:
 * it keeps at most one marker per user, and only what `add` was given.
 *
 * the user id of `add` and `remove` must be a uuid: anything else throws a RangeError whose
 * message holds no value, before any write. a storage failure throws. damaged stored content is
 * never thrown: it reads as no marker and is reported (ErrorReporter), each kind of damage once
 * per instance.
 */
export interface DevicePurgeMarkerRepository {
  /** the markers, in the order they were first added; empty when there is none. */
  list(): readonly DevicePurgeMarker[];
  /** stores `marker`, in place of the marker of the same user if any. */
  add(marker: DevicePurgeMarker): void;
  /** removes the marker of `userId`, if any; the stored document goes with the last marker. */
  remove(userId: string): void;
}
