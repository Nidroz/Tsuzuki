// the app foreground seam of the library providers (ADR-0017 "Hooks"): react native's AppState
// stays in src/platform/app-state.ts, whose subscribeToForeground the composition root passes

/**
 * subscribes `listener` to whether the app is in the foreground: called with the current state,
 * then on each change between foreground and not. returns the unsubscribe function
 */
export type ForegroundSubscription = (listener: (foreground: boolean) => void) => () => void;
