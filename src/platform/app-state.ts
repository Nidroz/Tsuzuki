import { AppState, type AppStateStatus } from 'react-native';

// the app in front of the user; inactive (ios transitions, the app switcher) and background are not
const FOREGROUND_STATE: AppStateStatus = 'active';

/** called with whether the app is in the foreground */
export type ForegroundListener = (foreground: boolean) => void;

/**
 * calls `listener` at once with whether the app is in the foreground, then on every change
 * between foreground and not (inactive then background is one change). the composition root binds
 * the auth token auto refresh to it (docs/ARCHITECTURE.md §8). returns the unsubscribe function
 */
export const subscribeToForeground = (listener: ForegroundListener): (() => void) => {
  let foreground = AppState.currentState === FOREGROUND_STATE;
  listener(foreground);
  const subscription = AppState.addEventListener('change', (state) => {
    const next = state === FOREGROUND_STATE;
    if (next !== foreground) {
      foreground = next;
      listener(next);
    }
  });
  return () => {
    subscription.remove();
  };
};
