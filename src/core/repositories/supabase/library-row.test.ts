import { describe, expect, it } from '@jest/globals';

import { entryOf, entryWithMedia } from '../../../../test/core/library-entry-fixtures';
import { LIBRARY_ROW_COLUMNS, parseLibraryRow, toLibraryRowPayload } from './library-row';

// a row as postgrest returns it for LIBRARY_ROW_COLUMNS, the stored form of entryOf()
const ROW = {
  id_namespace: 'mal',
  media_kind: 'anime',
  external_id: 52991,
  media_title: 'Sousou no Frieren',
  media_image_url: 'https://cdn.myanimelist.net/images/anime/1015/138006.jpg',
  media_format: 'tv',
  media_total_units: 28,
  media_is_adult: false,
  status: 'current',
  progress: 12,
  score: 9,
  notes: 'rewatch the finale',
  is_favorite: false,
  started_at: '2026-01-06',
  finished_at: null,
  created_at: '2026-01-05T10:00:00.000999+00:00',
  updated_at: '2026-02-10T20:30:00.000123+00:00',
};

const withoutColumn = (column: keyof typeof ROW): Record<string, unknown> =>
  Object.fromEntries(Object.entries(ROW).filter(([name]) => name !== column));

describe('LIBRARY_ROW_COLUMNS', () => {
  it('lists every entry column explicitly, never id or user_id', () => {
    const columns = LIBRARY_ROW_COLUMNS.split(', ');

    expect(columns).toStrictEqual(Object.keys(ROW));
    expect(columns).not.toContain('id');
    expect(columns).not.toContain('user_id');
    expect(columns).not.toContain('*');
  });
});

describe('parseLibraryRow', () => {
  it('maps a row to the entry, its timestamps in the Date#toISOString form', () => {
    expect(parseLibraryRow(ROW)).toStrictEqual(entryOf());
  });

  it('ignores columns it does not select', () => {
    const row = { ...ROW, id: '00000000-0000-4000-8000-000000000009', user_id: 'owner' };

    expect(parseLibraryRow(row)).toStrictEqual(entryOf());
  });

  it.each([
    { label: 'null', row: null },
    { label: 'an array', row: [ROW] },
    { label: 'a string', row: 'row' },
    { label: 'a row without notes', row: withoutColumn('notes') },
    { label: 'a row without media_is_adult', row: withoutColumn('media_is_adult') },
    { label: 'a format this version does not know', row: { ...ROW, media_format: 'hologram' } },
    { label: 'a status this version does not know', row: { ...ROW, status: 'rewatching' } },
    { label: 'a timestamp without offset', row: { ...ROW, updated_at: '2026-02-10T20:30:00' } },
    { label: 'a title over the limit', row: { ...ROW, media_title: 'x'.repeat(501) } },
  ])('returns null for $label', ({ row }) => {
    expect(parseLibraryRow(row)).toBeNull();
  });
});

describe('toLibraryRowPayload', () => {
  it('maps every writable column, never a server-set one', () => {
    const payload = toLibraryRowPayload(entryOf());

    expect(payload).toStrictEqual(withoutTimestamps(ROW));
    for (const column of ['id', 'user_id', 'created_at', 'updated_at']) {
      expect(payload).not.toHaveProperty(column);
    }
  });

  it.each([true, false])('always sets media_is_adult, here %p', (isAdult) => {
    expect(toLibraryRowPayload(entryWithMedia({ isAdult }))).toMatchObject({
      id_namespace: 'mal',
      media_is_adult: isAdult,
    });
  });

  it('is read back as the same entry once the server adds its timestamps', () => {
    const entry = entryWithMedia({ imageUrl: null, totalUnits: null, isAdult: true });

    const row = {
      ...toLibraryRowPayload(entry),
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
    };

    expect(parseLibraryRow(row)).toStrictEqual(entry);
  });
});

function withoutTimestamps(row: typeof ROW): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(([name]) => name !== 'created_at' && name !== 'updated_at'),
  );
}
