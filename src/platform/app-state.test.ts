import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

import { subscribeToForeground } from './app-state';

// the react native jest preset mocks AppState with jest functions, the current state included (which
// jest.replaceProperty refuses to replace): the current state is set, and restored after each test,
// and the change handler captured here
const presetCurrentState: unknown = AppState.currentState;

afterEach(() => {
  Reflect.set(AppState, 'currentState', presetCurrentState);
});

const stubAppState = (current: AppStateStatus) => {
  Reflect.set(AppState, 'currentState', current);
  const remove = jest.fn<() => void>();
  let handler: ((state: AppStateStatus) => void) | null = null;
  const addEventListener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, listener): NativeEventSubscription => {
      handler = listener;
      return { remove };
    });
  const change = (state: AppStateStatus) => {
    handler?.(state);
  };
  return { addEventListener, remove, change };
};

describe('subscribeToForeground', () => {
  it.each<[AppStateStatus, boolean]>([
    ['active', true],
    ['inactive', false],
    ['background', false],
    ['unknown', false],
  ])('reports the current state %s at once as foreground %s', (current, foreground) => {
    stubAppState(current);
    const listener = jest.fn<(foreground: boolean) => void>();

    subscribeToForeground(listener);

    expect(listener.mock.calls).toStrictEqual([[foreground]]);
  });

  it('reports each change between foreground and not, once', () => {
    const appState = stubAppState('active');
    const listener = jest.fn<(foreground: boolean) => void>();
    subscribeToForeground(listener);

    expect(appState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    appState.change('inactive');
    appState.change('background');
    appState.change('active');
    appState.change('active');

    expect(listener.mock.calls).toStrictEqual([[true], [false], [true]]);
  });

  it('removes its subscription when unsubscribed', () => {
    const appState = stubAppState('background');

    const unsubscribe = subscribeToForeground(jest.fn());

    expect(appState.remove).not.toHaveBeenCalled();

    unsubscribe();

    expect(appState.remove).toHaveBeenCalledTimes(1);
  });
});
