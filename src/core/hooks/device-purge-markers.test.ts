import { describe, expect, it, jest } from '@jest/globals';

import { createFakeDevicePurgeMarkers } from '../../../test/core/fake-device-purge-markers';
import {
  DEVICE_PURGE_MARKER_OPERATIONS,
  DevicePurgeMarkerOperationError,
} from '../errors/device-purge-errors';
import type { ErrorReporter } from '../errors/error-reporter';
import type { DevicePurgeMarker } from '../repositories/device-purge-marker-repository';
import { guardDevicePurgeMarkers } from './device-purge-markers';

const USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MARKER: DevicePurgeMarker = { userId: USER_ID, clearGuestLibrary: true, deviceWide: true };

const setup = (initial: readonly DevicePurgeMarker[] = []) => {
  const markers = createFakeDevicePurgeMarkers(initial);
  const captureError = jest.fn<ErrorReporter['captureError']>();
  return { markers, captureError, guarded: guardDevicePurgeMarkers(markers, { captureError }) };
};

describe('guardDevicePurgeMarkers', () => {
  it('lists, adds and removes through the repository', () => {
    const { markers, guarded, captureError } = setup();

    guarded.add(MARKER);
    expect(guarded.list()).toStrictEqual([MARKER]);
    guarded.remove(USER_ID);

    expect(markers.stored()).toStrictEqual([]);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('settles a purge whose account-library step succeeded by removing the marker', () => {
    const { markers, guarded } = setup([MARKER]);

    guarded.settle(USER_ID, ['query-cache', 'persisted-cache']);

    expect(markers.stored()).toStrictEqual([]);
  });

  it('settles a failed account-library step by rewriting the marker without the device-wide steps', () => {
    const { markers, guarded } = setup([MARKER]);

    guarded.settle(USER_ID, ['account-library', 'guest-library']);

    expect(markers.stored()).toStrictEqual([
      { userId: USER_ID, clearGuestLibrary: false, deviceWide: false },
    ]);
  });

  it.each(DEVICE_PURGE_MARKER_OPERATIONS)(
    'reports a failing %s with a fixed message and never throws',
    (operation) => {
      const { markers, guarded, captureError } = setup();
      markers[operation].mockImplementation(() => {
        throw new Error(`storage unavailable: ${USER_ID}`);
      });

      const call = {
        list: () => guarded.list(),
        add: () => {
          guarded.add(MARKER);
        },
        remove: () => {
          guarded.remove(USER_ID);
        },
      }[operation];

      expect(call).not.toThrow();
      expect(captureError).toHaveBeenCalledTimes(1);
      const [reported, context] = captureError.mock.calls[0] ?? [];
      expect(reported).toStrictEqual(new DevicePurgeMarkerOperationError(operation));
      expect(reported).not.toHaveProperty('cause');
      expect(context).toStrictEqual({ source: 'device-purge-marker', tags: { operation } });
    },
  );

  it('lists no marker when the read fails', () => {
    const { markers, guarded } = setup([MARKER]);
    markers.list.mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    expect(guarded.list()).toStrictEqual([]);
  });
});
