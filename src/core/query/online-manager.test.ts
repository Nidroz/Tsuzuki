import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';

import {
  followConnectivity,
  isDeviceOnline,
  type ConnectivitySubscription,
} from './online-manager';

// a connectivity source the test drives, recording its subscriptions
const createConnectivity = () => {
  const listeners = new Set<(online: boolean) => void>();
  const unsubscribed = jest.fn();
  const subscribe: ConnectivitySubscription = (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      unsubscribed();
    };
  };
  const emit = (online: boolean): void => {
    for (const listener of listeners) {
      listener(online);
    }
  };
  return { subscribe, emit, listeners, unsubscribed };
};

afterEach(() => {
  // the onlineManager is one per test file: leave it online and detached
  onlineManager.setEventListener(() => undefined);
  onlineManager.setOnline(true);
});

describe('followConnectivity', () => {
  it('makes onlineManager and isDeviceOnline follow the device connectivity', () => {
    const connectivity = createConnectivity();
    followConnectivity(connectivity.subscribe);

    connectivity.emit(false);
    expect(isDeviceOnline()).toBe(false);
    expect(onlineManager.isOnline()).toBe(false);

    connectivity.emit(true);
    expect(isDeviceOnline()).toBe(true);
  });

  it('notifies the subscribers of onlineManager on a change only', () => {
    const connectivity = createConnectivity();
    followConnectivity(connectivity.subscribe);
    const listener = jest.fn();
    const unsubscribe = onlineManager.subscribe(listener);

    connectivity.emit(false);
    connectivity.emit(false);
    connectivity.emit(true);
    unsubscribe();

    expect(listener.mock.calls).toStrictEqual([[false], [true]]);
  });

  it('releases the previous source when bound to another one', () => {
    const first = createConnectivity();
    const second = createConnectivity();
    followConnectivity(first.subscribe);

    followConnectivity(second.subscribe);
    first.emit(false);

    expect(first.unsubscribed).toHaveBeenCalledTimes(1);
    expect(first.listeners.size).toBe(0);
    expect(isDeviceOnline()).toBe(true);
    second.emit(false);
    expect(isDeviceOnline()).toBe(false);
  });

  it('subscribes again for a new listener after the last one left', () => {
    const connectivity = createConnectivity();
    followConnectivity(connectivity.subscribe);

    onlineManager.subscribe(jest.fn())();
    expect(connectivity.listeners.size).toBe(0);
    const unsubscribe = onlineManager.subscribe(jest.fn());
    connectivity.emit(false);

    expect(isDeviceOnline()).toBe(false);
    unsubscribe();
  });
});
