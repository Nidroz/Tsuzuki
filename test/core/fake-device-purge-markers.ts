// a test double of the purge-pending markers (src/core/repositories/device-purge-marker-repository.ts)
// for the device purge hooks and the trees that render DevicePurgeContextProvider: in memory, one
// marker per user in the order first added, as the contract states; no storage, no uuid check
import { jest } from '@jest/globals';

import type {
  DevicePurgeMarker,
  DevicePurgeMarkerRepository,
} from '@core/repositories/device-purge-marker-repository';

/** the markers `initial` (empty by default), whose calls stay jest mocks and `stored()` reads */
export const createFakeDevicePurgeMarkers = (initial: readonly DevicePurgeMarker[] = []) => {
  let markers: readonly DevicePurgeMarker[] = initial;
  return {
    list: jest.fn<DevicePurgeMarkerRepository['list']>(() => markers),
    add: jest.fn<DevicePurgeMarkerRepository['add']>((marker) => {
      const index = markers.findIndex(({ userId }) => userId === marker.userId);
      markers =
        index === -1
          ? [...markers, marker]
          : markers.map((stored, at) => (at === index ? marker : stored));
    }),
    remove: jest.fn<DevicePurgeMarkerRepository['remove']>((userId) => {
      markers = markers.filter((marker) => marker.userId !== userId);
    }),
    /** the markers now, as a later launch would list them */
    stored: (): readonly DevicePurgeMarker[] => markers,
  } satisfies DevicePurgeMarkerRepository & { stored: () => readonly DevicePurgeMarker[] };
};

export type FakeDevicePurgeMarkers = ReturnType<typeof createFakeDevicePurgeMarkers>;
