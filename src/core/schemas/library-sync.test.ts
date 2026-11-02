import { describe, expect, it } from '@jest/globals';

import { entryOf, keyOf } from '../../../test/core/library-entry-fixtures';
import { libraryQueuedWriteSchema } from './library-sync';

const KEY = keyOf('manga', 8);

describe('libraryQueuedWriteSchema', () => {
  it('parses a save and a removal, normalizing their times and stripping unknown fields', () => {
    const entry = entryOf();

    expect(
      libraryQueuedWriteSchema.parse({ type: 'save', entry: { ...entry, extra: 1 }, extra: 2 }),
    ).toStrictEqual({ type: 'save', entry });
    expect(
      libraryQueuedWriteSchema.parse({
        type: 'remove',
        key: KEY,
        removedAt: '2026-02-01T01:00:00+01:00',
      }),
    ).toStrictEqual({ type: 'remove', key: KEY, removedAt: '2026-02-01T00:00:00.000Z' });
  });

  it.each([
    { label: 'an unknown type', write: { type: 'merge', key: KEY } },
    { label: 'a save outside the limits', write: { type: 'save', entry: entryOf({ score: 11 }) } },
    {
      label: 'a removal of an invalid key',
      write: { type: 'remove', key: keyOf('anime', 0), removedAt: '2026-02-01T00:00:00Z' },
    },
    { label: 'a removal without its time', write: { type: 'remove', key: KEY } },
    {
      label: 'a removal at an invalid time',
      write: { type: 'remove', key: KEY, removedAt: 'infinity' },
    },
  ])('rejects $label', ({ write }) => {
    expect(libraryQueuedWriteSchema.safeParse(write).success).toBe(false);
  });
});
