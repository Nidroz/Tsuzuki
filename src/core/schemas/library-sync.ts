// a queued write of the account library (A-05, ADR-0017) as stored on the device and as sent to
// the replay: parsed on every read of the device queue and before every replay call. issues hold
// no value
import { z } from 'zod';

import type { LibraryQueuedWrite } from '../domain/library-sync';
import { libraryEntrySchema, mediaKeySchema } from './library-entry';
import { timestampSchema } from './timestamp';

/**
 * a queued write within the database limits: a save whose entry passes libraryEntrySchema, or a
 * removal of a valid media key at a valid time. times are normalized to the `Date#toISOString`
 * form; unknown fields are stripped.
 */
export const libraryQueuedWriteSchema: z.ZodType<LibraryQueuedWrite> = z.discriminatedUnion(
  'type',
  [
    z.object({ type: z.literal('save'), entry: libraryEntrySchema }),
    z.object({ type: z.literal('remove'), key: mediaKeySchema, removedAt: timestampSchema }),
  ],
);
