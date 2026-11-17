import { describe, expect, it, jest } from '@jest/globals';

import {
  createFakeDevicePurgeMarkers,
  type FakeDevicePurgeMarkers,
} from '../../../test/core/fake-device-purge-markers';
import {
  DevicePurgeMarkerOperationError,
  type DevicePurgeMarkerOperation,
} from '../errors/device-purge-errors';
import type { ErrorReporter } from '../errors/error-reporter';
import type { DevicePurgeMarker } from '../repositories/device-purge-marker-repository';
import { guardOwedDevicePurges, settleOwedDevicePurges } from './owed-device-purges';

// the purges a memory app storage owes to the files (R-09): recorded by each purge of the memory
// process, carried into the purge-pending markers by the next launch on the files, dropped by a
// first launch, over marker fakes. a damaged owed document reads as no owed purge (the marker
// repository's contract), so nothing is carried: the route tests of the composition root show it
// over the real repository and secure store

const USER_A = '00000000-0000-4000-8000-00000000000a';
const USER_B = '00000000-0000-4000-8000-00000000000b';

const markerOf = (
  userId: string,
  clearGuestLibrary: boolean,
  deviceWide: boolean,
): DevicePurgeMarker => ({ userId, clearGuestLibrary, deviceWide });

// the owed store and the markers of the files, each holding its initial markers
const setup = (
  owedInitial: readonly DevicePurgeMarker[] = [],
  markedInitial: readonly DevicePurgeMarker[] = [],
) => {
  const captureError = jest.fn<ErrorReporter['captureError']>();
  const reporter: ErrorReporter = { captureError };
  const owed = createFakeDevicePurgeMarkers(owedInitial);
  const markers = createFakeDevicePurgeMarkers(markedInitial);
  const settle = (persistent: boolean, firstLaunch: boolean): void => {
    settleOwedDevicePurges({ owed, markers, persistent, firstLaunch, reporter });
  };
  return { owed, markers, captureError, reporter, settle };
};

const operationReport = (operation: DevicePurgeMarkerOperation) => [
  new DevicePurgeMarkerOperationError(operation),
  { source: 'device-purge-marker', tags: { operation } },
];

// the secure store write fails, its error quoting what it touched
const failCalls = (store: FakeDevicePurgeMarkers, call: 'list' | 'add' | 'remove'): void => {
  store[call].mockImplementation(() => {
    throw new Error(`keychain call failed near ${USER_A}`);
  });
};

describe('guardOwedDevicePurges', () => {
  it('records the user with the guest library kept, and never lowers a device-wide flag', () => {
    const { owed, reporter, captureError } = setup();
    const owe = guardOwedDevicePurges(owed, reporter);

    owe(USER_A, false);
    expect(owed.stored()).toStrictEqual([markerOf(USER_A, false, false)]);
    owe(USER_A, true);
    owe(USER_A, false);
    owe(USER_B, false);

    expect(owed.stored()).toStrictEqual([
      markerOf(USER_A, false, true),
      markerOf(USER_B, false, false),
    ]);
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each(['list', 'add'] as const)(
    'reports a record whose %s fails as owe, quoting nothing, and never throws',
    (call) => {
      const { owed, reporter, captureError } = setup();
      failCalls(owed, call);

      expect(() => {
        guardOwedDevicePurges(owed, reporter)(USER_A, true);
      }).not.toThrow();

      expect(captureError.mock.calls).toStrictEqual([operationReport('owe')]);
      expect(JSON.stringify(captureError.mock.calls)).not.toContain(USER_A);
    },
  );
});

describe('settleOwedDevicePurges', () => {
  it.each([true, false])(
    'drops every owed purge at a first launch (persistent %s), the markers untouched',
    (persistent) => {
      const marked = [markerOf(USER_B, true, true)];
      const { owed, markers, captureError, settle } = setup(
        [markerOf(USER_A, false, true), markerOf(USER_B, false, false)],
        marked,
      );

      settle(persistent, true);

      expect(owed.stored()).toStrictEqual([]);
      expect(markers.stored()).toStrictEqual(marked);
      expect(markers.add).not.toHaveBeenCalled();
      expect(captureError).not.toHaveBeenCalled();
    },
  );

  it('reports a first launch that cannot drop an owed purge, never thrown', () => {
    const { owed, captureError, settle } = setup([markerOf(USER_A, false, true)]);
    failCalls(owed, 'remove');

    expect(() => {
      settle(true, true);
    }).not.toThrow();

    expect(captureError.mock.calls).toStrictEqual([operationReport('remove')]);
  });

  it('carries each owed purge into the markers of the files, its flags merged, then drops it', () => {
    const { owed, markers, captureError, settle } = setup(
      [markerOf(USER_A, false, true), markerOf(USER_B, false, false)],
      // a launch purge of A whose account-library step failed: the guest library owed, not the rest
      [markerOf(USER_A, true, false)],
    );

    settle(true, false);

    expect(markers.stored()).toStrictEqual([
      markerOf(USER_A, true, true),
      markerOf(USER_B, false, false),
    ]);
    expect(owed.stored()).toStrictEqual([]);
    // each owed purge leaves the owed store only once its marker is written
    expect(markers.add.mock.invocationCallOrder[0]).toBeLessThan(
      owed.remove.mock.invocationCallOrder[0] ?? 0,
    );
    expect(captureError).not.toHaveBeenCalled();
  });

  it('keeps an owed purge whose carry failed, reported, the others carried, and carries it later', () => {
    const { owed, markers, captureError, settle } = setup([
      markerOf(USER_A, false, true),
      markerOf(USER_B, false, false),
    ]);
    markers.add.mockImplementationOnce(() => {
      throw new Error(`keychain write failed near ${USER_A}`);
    });

    settle(true, false);

    expect(captureError.mock.calls).toStrictEqual([operationReport('carry')]);
    expect(owed.stored()).toStrictEqual([markerOf(USER_A, false, true)]);
    expect(markers.stored()).toStrictEqual([markerOf(USER_B, false, false)]);

    settle(true, false);

    expect(markers.stored()).toStrictEqual([
      markerOf(USER_B, false, false),
      markerOf(USER_A, false, true),
    ]);
    expect(owed.stored()).toStrictEqual([]);
  });

  it.each(['owed', 'markers'] as const)(
    'carries nothing when the %s cannot be listed, reported as carry',
    (store) => {
      const owedPurge = markerOf(USER_A, false, true);
      const rendered = setup([owedPurge]);
      failCalls(rendered[store], 'list');

      rendered.settle(true, false);

      expect(rendered.captureError.mock.calls).toStrictEqual([operationReport('carry')]);
      expect(rendered.markers.add).not.toHaveBeenCalled();
      expect(rendered.owed.stored()).toStrictEqual([owedPurge]);
    },
  );

  it('reads nothing when nothing is owed', () => {
    const { markers, captureError, settle } = setup([], [markerOf(USER_B, true, true)]);

    settle(true, false);

    expect(markers.list).not.toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
  });

  it('touches nothing while this launch runs on memory too', () => {
    const owedPurge = markerOf(USER_A, false, true);
    const { owed, markers, captureError, settle } = setup([owedPurge]);

    settle(false, false);

    expect(owed.list).not.toHaveBeenCalled();
    expect(markers.list).not.toHaveBeenCalled();
    expect(owed.stored()).toStrictEqual([owedPurge]);
    expect(captureError).not.toHaveBeenCalled();
  });
});
