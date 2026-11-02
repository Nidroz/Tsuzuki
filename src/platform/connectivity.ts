import type { ErrorReporter } from '@core/errors/error-reporter';
import type { ConnectivitySubscription } from '@core/query/online-manager';
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network';

/** the source of the report of a failed initial read of the network state */
export const CONNECTIVITY_REPORT_SOURCE = 'connectivity';

// online: a network is connected, and the os did not find the internet unreachable (null or
// undefined while it is still checking: the device is taken as online until it says otherwise)
const isOnline = ({ isConnected, isInternetReachable }: NetworkState): boolean =>
  isConnected === true && isInternetReachable !== false;

/**
 * the core ConnectivitySubscription over expo-network (ADR-0017 "Connectivity"), bound by the
 * composition root to TanStack's onlineManager (followConnectivity). each subscription listens to
 * the network state events, and reads the initial state once: a read that settles after an event
 * is dropped, the event being newer. a failed initial read leaves the state to the events (the
 * onlineManager keeps its last value, online by default) and goes to `reporter`, never thrown
 */
export const createConnectivitySubscription =
  (reporter: ErrorReporter): ConnectivitySubscription =>
  (listener) => {
    let active = true;
    let heardEvent = false;
    const subscription = addNetworkStateListener((state) => {
      heardEvent = true;
      listener(isOnline(state));
    });
    getNetworkStateAsync().then(
      (state) => {
        if (active && !heardEvent) {
          listener(isOnline(state));
        }
      },
      (error: unknown) => {
        reporter.captureError(error, { source: CONNECTIVITY_REPORT_SOURCE });
      },
    );
    return () => {
      active = false;
      subscription.remove();
    };
  };
