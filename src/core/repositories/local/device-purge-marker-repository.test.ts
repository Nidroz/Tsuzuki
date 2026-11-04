import { describe, expect, it } from '@jest/globals';

import {
  DevicePurgeMarkerError,
  type DevicePurgeMarkerProblem,
} from '../../errors/device-purge-errors';
import type { DevicePurgeMarker } from '../device-purge-marker-repository';
import { createMemoryStorage, createRecordingReporter } from './__fixtures__/memory-storage';
import {
  DEVICE_PURGE_MARKER_REPORT_SOURCE,
  DEVICE_PURGE_MARKER_STORAGE_KEY,
  createLocalDevicePurgeMarkerRepository,
} from './device-purge-marker-repository';

// the purge-pending markers (ADR-0018, update of 2026-11-04): one document, at most one marker per
// user, the user id checked as a uuid before any write, a damaged document read as no marker and
// reported once per problem, never thrown

const USER_A = '00000000-0000-4000-8000-00000000000a';
const USER_B = '00000000-0000-4000-8000-00000000000b';

const markerOf = (
  userId: string,
  clearGuestLibrary = true,
  deviceWide = true,
): DevicePurgeMarker => ({ userId, clearGuestLibrary, deviceWide });

const documentOf = (users: readonly unknown[], version: unknown = 1): string =>
  JSON.stringify({ version, users });

// a repository over a storage holding `stored` under the marker key, when given
const setup = (stored?: string) => {
  const storage = createMemoryStorage();
  if (stored !== undefined) {
    storage.values.set(DEVICE_PURGE_MARKER_STORAGE_KEY, stored);
  }
  const { reporter, captureError } = createRecordingReporter();
  const repository = createLocalDevicePurgeMarkerRepository(storage, { reporter });
  return { storage, repository, captureError };
};

// the report of a damaged document: the problem only, as the error and as the only tag
const reportOf = (problem: DevicePurgeMarkerProblem) => [
  new DevicePurgeMarkerError(problem),
  { source: DEVICE_PURGE_MARKER_REPORT_SOURCE, tags: { problem } },
];

describe('createLocalDevicePurgeMarkerRepository', () => {
  it('lists no marker and stores nothing on an empty storage', () => {
    const { storage, repository, captureError } = setup();

    expect(repository.list()).toStrictEqual([]);
    expect(storage.values.size).toBe(0);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('adds markers in order and stores nothing but the user id and the two flags', () => {
    const { storage, repository } = setup();
    const withExtra = { ...markerOf(USER_A, true, false), email: 'reader@example.com' };

    repository.add(withExtra);
    repository.add(markerOf(USER_B, false, true));

    expect(repository.list()).toStrictEqual([
      markerOf(USER_A, true, false),
      markerOf(USER_B, false, true),
    ]);
    expect(storage.values.get(DEVICE_PURGE_MARKER_STORAGE_KEY)).toBe(
      '{"version":1,"users":[' +
        `{"userId":"${USER_A}","clearGuestLibrary":true,"deviceWide":false},` +
        `{"userId":"${USER_B}","clearGuestLibrary":false,"deviceWide":true}]}`,
    );
  });

  it('replaces the marker of the same user in place', () => {
    const { repository } = setup();
    repository.add(markerOf(USER_A));
    repository.add(markerOf(USER_B));

    repository.add(markerOf(USER_A, false, false));

    expect(repository.list()).toStrictEqual([markerOf(USER_A, false, false), markerOf(USER_B)]);
  });

  it('removes one user only, and the document with the last marker', () => {
    const { storage, repository } = setup();
    repository.add(markerOf(USER_A));
    repository.add(markerOf(USER_B));

    repository.remove(USER_A);
    expect(repository.list()).toStrictEqual([markerOf(USER_B)]);

    repository.remove(USER_A);
    expect(repository.list()).toStrictEqual([markerOf(USER_B)]);

    repository.remove(USER_B);
    expect(repository.list()).toStrictEqual([]);
    expect(storage.values.has(DEVICE_PURGE_MARKER_STORAGE_KEY)).toBe(false);
  });

  it('lists the markers again after a restart (a new instance over the same storage)', () => {
    const { storage, repository } = setup();
    repository.add(markerOf(USER_A, false, true));

    const { reporter } = createRecordingReporter();
    const restarted = createLocalDevicePurgeMarkerRepository(storage, { reporter });

    expect(restarted.list()).toStrictEqual([markerOf(USER_A, false, true)]);
  });

  it('returns markers the caller cannot change', () => {
    const { repository } = setup();
    repository.add(markerOf(USER_A));

    const [marker] = repository.list();

    expect(Object.isFrozen(marker)).toBe(true);
  });

  it.each(['not-a-uuid', '', `${USER_A}0`, '../recent-searches'])(
    'throws a RangeError without the value for the user id %p, before any write',
    (userId) => {
      const { storage, repository } = setup();
      repository.add(markerOf(USER_A));
      const before = new Map(storage.values);

      for (const call of [
        () => {
          repository.add(markerOf(userId));
        },
        () => {
          repository.remove(userId);
        },
      ]) {
        expect(call).toThrow(new RangeError('device purge marker user id is not a uuid'));
      }
      expect(storage.values).toStrictEqual(before);
    },
  );

  it.each<[string, string, DevicePurgeMarkerProblem]>([
    ['not json', '{"version":1,', 'invalid-json'],
    ['an unknown version', documentOf([markerOf(USER_A)], 2), 'invalid-envelope'],
    ['no users array', JSON.stringify({ version: 1, users: {} }), 'invalid-envelope'],
    ['an array', JSON.stringify([markerOf(USER_A)]), 'invalid-envelope'],
    ['null', 'null', 'invalid-envelope'],
  ])('reads %s as no marker, reported once, never thrown', (_case, stored, problem) => {
    const { repository, captureError } = setup(stored);

    expect(repository.list()).toStrictEqual([]);
    expect(repository.list()).toStrictEqual([]);

    expect(captureError.mock.calls).toStrictEqual([reportOf(problem)]);
  });

  it('drops each invalid marker alone and reports it once', () => {
    const { repository, captureError } = setup(
      documentOf([
        markerOf(USER_A),
        { userId: 'not-a-uuid', clearGuestLibrary: true, deviceWide: true },
        { userId: USER_B, clearGuestLibrary: 'yes', deviceWide: true },
        { userId: USER_B, deviceWide: true },
        null,
      ]),
    );

    expect(repository.list()).toStrictEqual([markerOf(USER_A)]);
    expect(repository.list()).toStrictEqual([markerOf(USER_A)]);
    expect(captureError.mock.calls).toStrictEqual([reportOf('invalid-markers')]);
  });

  it('keeps one marker per user from a document naming a user twice: the last one', () => {
    const { repository, captureError } = setup(
      documentOf([markerOf(USER_A, true, true), markerOf(USER_B), markerOf(USER_A, false, false)]),
    );

    expect(repository.list()).toStrictEqual([markerOf(USER_A, false, false), markerOf(USER_B)]);
    expect(captureError.mock.calls).toStrictEqual([reportOf('duplicate-users')]);
  });

  it('rewrites a damaged document with the markers it could read', () => {
    const { storage, repository } = setup(
      documentOf([markerOf(USER_A), { userId: USER_B }, markerOf(USER_A, false, false)]),
    );

    repository.add(markerOf(USER_B));

    expect(storage.values.get(DEVICE_PURGE_MARKER_STORAGE_KEY)).toBe(
      documentOf([markerOf(USER_A, false, false), markerOf(USER_B)]),
    );
  });

  it('replaces an unreadable document on add, and removes it when nothing is left', () => {
    const { storage, repository } = setup('not json');

    repository.add(markerOf(USER_A));
    expect(storage.values.get(DEVICE_PURGE_MARKER_STORAGE_KEY)).toBe(
      documentOf([markerOf(USER_A)]),
    );

    storage.values.set(DEVICE_PURGE_MARKER_STORAGE_KEY, 'not json');
    repository.remove(USER_B);
    expect(storage.values.has(DEVICE_PURGE_MARKER_STORAGE_KEY)).toBe(false);
  });

  it('reports no user id and no stored content', () => {
    const { repository, captureError } = setup(
      documentOf([{ userId: USER_A, clearGuestLibrary: 'reader@example.com' }]),
    );

    repository.list();

    const reported = JSON.stringify(
      captureError.mock.calls.map(([error, context]) => [
        error instanceof Error ? error.message : error,
        context,
      ]),
    );
    expect(reported).not.toContain(USER_A);
    expect(reported).not.toContain('reader@example.com');
  });
});
