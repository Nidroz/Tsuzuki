// the TanStack onlineManager bound to the device connectivity (ADR-0017 "Connectivity"): catalog
// queries pause offline instead of failing, and the offline account library and the catalog
// failure monitor read the same online flag. the platform function (src/platform/connectivity.ts,
// expo-network on mobile) is injected by the composition root: core never imports it
import { onlineManager } from '@tanstack/react-query';

/**
 * subscribes `listener` to the device connectivity: called with the initial state once read, then
 * on each change (`true` online). returns the unsubscribe function.
 */
export type ConnectivitySubscription = (listener: (online: boolean) => void) => () => void;

/**
 * makes TanStack's onlineManager follow `subscribe` instead of its default browser events. called
 * once by the composition root; the onlineManager unsubscribes when its last listener leaves and
 * subscribes again for the next one.
 */
export const followConnectivity = (subscribe: ConnectivitySubscription): void => {
  onlineManager.setEventListener((setOnline) => subscribe(setOnline));
};

/** whether the device is online now, as onlineManager last heard. */
export const isDeviceOnline = (): boolean => onlineManager.isOnline();
