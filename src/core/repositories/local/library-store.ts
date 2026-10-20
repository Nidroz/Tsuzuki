// the stored document of the guest library (docs/ARCHITECTURE.md §4 "Guest store"): a versioned
// json envelope of entries in the domain shape. stored content is untrusted and parsed on every
// read; these helpers are pure, the repository reads, writes and reports
import { z } from 'zod';

import type { LibraryEntry } from '../../domain/library-entry';
import { MEDIA_ID_NAMESPACES, MEDIA_KINDS, type MediaKey } from '../../domain/media';
import type { LibraryStorageReason } from '../../errors/library-errors';
import { libraryEntrySchema } from '../../schemas/library-entry';

/**
 * the envelope version this reader understands. a later version must stay readable by this reader,
 * or use a new key: an older bundle reads an unknown version as empty and replaces it on its next
 * write (docs/ARCHITECTURE.md §4).
 */
const GUEST_LIBRARY_ENVELOPE_VERSION = 1;

// the envelope is checked here, every entry on its own below, so one bad entry drops alone
const envelopeSchema = z.object({
  version: z.literal(GUEST_LIBRARY_ENVELOPE_VERSION),
  entries: z.array(z.unknown()),
});

/** the entries read from the stored document, and the problems met on the way (each once). */
export interface GuestLibraryRead {
  readonly entries: readonly LibraryEntry[];
  readonly problems: ReadonlySet<LibraryStorageReason>;
}

const EMPTY_READ: GuestLibraryRead = { entries: [], problems: new Set() };

const failedRead = (reason: LibraryStorageReason): GuestLibraryRead => ({
  entries: [],
  problems: new Set([reason]),
});

// a map key of a media key: namespaces and kinds hold no colon
const mediaKeyIdOf = (key: MediaKey): string =>
  `${key.namespace}:${key.kind}:${String(key.externalId)}`;

const rankOf = (values: readonly string[], value: string): number => values.indexOf(value);

/** whether two media keys name the same media. */
export const isSameMediaKey = (a: MediaKey, b: MediaKey): boolean =>
  mediaKeyIdOf(a) === mediaKeyIdOf(b);

/**
 * the media key order: namespace then kind in the order of MEDIA_ID_NAMESPACES and MEDIA_KINDS
 * (the postgres enum order), then externalId, ascending.
 */
const compareMediaKeys = (a: MediaKey, b: MediaKey): number =>
  rankOf(MEDIA_ID_NAMESPACES, a.namespace) - rankOf(MEDIA_ID_NAMESPACES, b.namespace) ||
  rankOf(MEDIA_KINDS, a.kind) - rankOf(MEDIA_KINDS, b.kind) ||
  a.externalId - b.externalId;

/**
 * the list order of LibraryRepository: `updatedAt` descending (normalized timestamps compare as
 * strings), then the key ascending.
 */
const compareLibraryEntries = (a: LibraryEntry, b: LibraryEntry): number => {
  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt > b.updatedAt ? -1 : 1;
  }
  return compareMediaKeys(a.key, b.key);
};

/** `entries` in the list order, as a new array. */
export const sortLibraryEntries = (entries: readonly LibraryEntry[]): LibraryEntry[] =>
  [...entries].sort(compareLibraryEntries);

const parseJson = (stored: string): { readonly ok: true; readonly value: unknown } | null => {
  try {
    return { ok: true, value: JSON.parse(stored) };
  } catch {
    // invalid json is reported by the caller as a problem, never thrown
    return null;
  }
};

/**
 * reads the stored document (`undefined` when nothing is stored), in the list order. invalid json
 * or an invalid envelope (an unknown version included) reads as empty; an entry libraryEntrySchema
 * rejects is dropped; of entries with the same key, the most recent `updatedAt` is kept, the first
 * stored on a tie. each kind of problem is returned once; nothing is thrown.
 */
export const readGuestLibrary = (stored: string | undefined): GuestLibraryRead => {
  if (stored === undefined) {
    return EMPTY_READ;
  }
  const json = parseJson(stored);
  if (json === null) {
    return failedRead('invalid-json');
  }
  const envelope = envelopeSchema.safeParse(json.value);
  if (!envelope.success) {
    return failedRead('invalid-envelope');
  }
  const problems = new Set<LibraryStorageReason>();
  // insertion order is the stored order, so a tie keeps the first stored entry
  const byKey = new Map<string, LibraryEntry>();
  for (const raw of envelope.data.entries) {
    const parsed = libraryEntrySchema.safeParse(raw);
    if (!parsed.success) {
      problems.add('invalid-entries');
      continue;
    }
    const entry = parsed.data;
    const id = mediaKeyIdOf(entry.key);
    const previous = byKey.get(id);
    if (previous !== undefined) {
      problems.add('duplicate-keys');
    }
    if (previous === undefined || entry.updatedAt > previous.updatedAt) {
      byKey.set(id, entry);
    }
  }
  return { entries: sortLibraryEntries([...byKey.values()]), problems };
};

/** the stored document of `entries`: the version 1 envelope, as json. */
export const serializeGuestLibrary = (entries: readonly LibraryEntry[]): string =>
  JSON.stringify({ version: GUEST_LIBRARY_ENVELOPE_VERSION, entries });
