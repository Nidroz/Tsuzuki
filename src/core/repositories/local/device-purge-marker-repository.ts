// the purge-pending markers (ADR-0018, update of 2026-11-04) in one document of the synchronous
// StorageAdapter. no in-memory cache: each call reads, changes and writes the document inside the
// call, so two instances over one storage never interleave. stored content is untrusted and parsed
// with zod on every read; a damaged document is reported, never thrown. a user id is personal
// data: never logged, never in an error or a report tag
import { z } from 'zod';

import {
  DevicePurgeMarkerError,
  type DevicePurgeMarkerProblem,
} from '../../errors/device-purge-errors';
import type { ErrorReporter } from '../../errors/error-reporter';
import type {
  DevicePurgeMarker,
  DevicePurgeMarkerRepository,
} from '../device-purge-marker-repository';
import type { StorageAdapter } from '../storage-adapter';

/** the storage key of the marker document: `{ "version": 1, "users": [...] }`. */
export const DEVICE_PURGE_MARKER_STORAGE_KEY = 'device-purge-pending';

/** the source of the reports of a damaged marker document. */
export const DEVICE_PURGE_MARKER_REPORT_SOURCE = 'device-purge-marker';

/**
 * the envelope version this reader understands; a later version must stay readable by it, or use
 * a new key (an older bundle reads an unknown version as no marker).
 */
const MARKER_ENVELOPE_VERSION = 1;

// a user id as supabase issues it: checked before any write
const userIdSchema = z.uuid();

// the envelope is checked here, every marker on its own below, so one bad marker drops alone
const envelopeSchema = z.object({
  version: z.literal(MARKER_ENVELOPE_VERSION),
  users: z.array(z.unknown()),
});

const markerSchema = z.object({
  userId: userIdSchema,
  clearGuestLibrary: z.boolean(),
  deviceWide: z.boolean(),
});

interface MarkersRead {
  readonly markers: readonly DevicePurgeMarker[];
  readonly problems: ReadonlySet<DevicePurgeMarkerProblem>;
}

const NO_MARKER: readonly DevicePurgeMarker[] = [];

// invalid json is a problem the caller reports, never thrown
const parseJson = (stored: string): { readonly value: unknown } | null => {
  try {
    return { value: JSON.parse(stored) };
  } catch {
    return null;
  }
};

// only the three fields, whatever else the object holds
const markerOf = ({
  userId,
  clearGuestLibrary,
  deviceWide,
}: DevicePurgeMarker): DevicePurgeMarker =>
  Object.freeze({ userId, clearGuestLibrary, deviceWide });

/**
 * reads the document (`undefined` when nothing is stored). invalid json or an invalid envelope
 * reads as no marker; a marker failing its schema is dropped; of several markers of one user, the
 * last one is kept, at the position of the first (as `add` replaces).
 */
const readMarkers = (stored: string | undefined): MarkersRead => {
  if (stored === undefined) {
    return { markers: NO_MARKER, problems: new Set() };
  }
  const json = parseJson(stored);
  if (json === null) {
    return { markers: NO_MARKER, problems: new Set(['invalid-json']) };
  }
  const envelope = envelopeSchema.safeParse(json.value);
  if (!envelope.success) {
    return { markers: NO_MARKER, problems: new Set(['invalid-envelope']) };
  }
  const problems = new Set<DevicePurgeMarkerProblem>();
  const byUser = new Map<string, DevicePurgeMarker>();
  for (const raw of envelope.data.users) {
    const parsed = markerSchema.safeParse(raw);
    if (!parsed.success) {
      problems.add('invalid-markers');
      continue;
    }
    if (byUser.has(parsed.data.userId)) {
      problems.add('duplicate-users');
    }
    byUser.set(parsed.data.userId, markerOf(parsed.data));
  }
  return { markers: [...byUser.values()], problems };
};

const assertUserId = (userId: string): void => {
  if (!userIdSchema.safeParse(userId).success) {
    throw new RangeError('device purge marker user id is not a uuid');
  }
};

export interface LocalDevicePurgeMarkerOptions {
  /** receives each problem of a damaged document, once per problem and instance. */
  readonly reporter: ErrorReporter;
}

/** the DevicePurgeMarkerRepository over `storage` (../device-purge-marker-repository.ts). */
export const createLocalDevicePurgeMarkerRepository = (
  storage: StorageAdapter,
  { reporter }: LocalDevicePurgeMarkerOptions,
): DevicePurgeMarkerRepository => {
  const reported = new Set<DevicePurgeMarkerProblem>();

  const read = (): readonly DevicePurgeMarker[] => {
    const { markers, problems } = readMarkers(storage.getString(DEVICE_PURGE_MARKER_STORAGE_KEY));
    for (const problem of problems) {
      if (!reported.has(problem)) {
        reported.add(problem);
        reporter.captureError(new DevicePurgeMarkerError(problem), {
          source: DEVICE_PURGE_MARKER_REPORT_SOURCE,
          tags: { problem },
        });
      }
    }
    return markers;
  };

  // a damaged document is replaced by what could be read of it; no marker left removes it
  const write = (markers: readonly DevicePurgeMarker[]): void => {
    if (markers.length === 0) {
      storage.delete(DEVICE_PURGE_MARKER_STORAGE_KEY);
      return;
    }
    storage.set(
      DEVICE_PURGE_MARKER_STORAGE_KEY,
      JSON.stringify({ version: MARKER_ENVELOPE_VERSION, users: markers.map(markerOf) }),
    );
  };

  return {
    list: read,

    add: (marker) => {
      assertUserId(marker.userId);
      const markers = read();
      const index = markers.findIndex(({ userId }) => userId === marker.userId);
      write(
        index === -1
          ? [...markers, marker]
          : markers.map((stored, at) => (at === index ? marker : stored)),
      );
    },

    remove: (userId) => {
      assertUserId(userId);
      write(read().filter((marker) => marker.userId !== userId));
    },
  };
};
