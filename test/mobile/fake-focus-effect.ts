// a stand-in for expo-router's useFocusEffect, for the screens rendered without a navigator (the
// real hook needs one): the effect runs once the screen is mounted, as on its first focus, and
// again on each refocusScreens(), as when the user comes back to it. a test mocks expo-router with
// it: useFocusEffect: jest.requireActual<typeof FakeFocusEffect>('…/fake-focus-effect').useFakeFocusEffect
import { act } from '@testing-library/react-native';
import { useEffect, type EffectCallback } from 'react';

type Cleanup = ReturnType<EffectCallback>;

// the effect of each mounted screen, with the cleanup of its last run
const focusEffects = new Map<EffectCallback, Cleanup>();

const runCleanup = (cleanup: Cleanup): void => {
  if (typeof cleanup === 'function') {
    cleanup();
  }
};

/** useFocusEffect of a screen that is focused once mounted; refocusScreens() focuses it again */
export function useFakeFocusEffect(effect: EffectCallback): void {
  useEffect(() => {
    focusEffects.set(effect, effect());
    return () => {
      runCleanup(focusEffects.get(effect));
      focusEffects.delete(effect);
    };
  }, [effect]);
}

/** every mounted screen loses the focus and gains it again, as after a tab switch */
export const refocusScreens = async (): Promise<void> => {
  await act(() => {
    for (const [effect, cleanup] of focusEffects) {
      runCleanup(cleanup);
      focusEffects.set(effect, effect());
    }
  });
};
