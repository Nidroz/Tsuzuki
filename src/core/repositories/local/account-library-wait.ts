// the wait of a replay run before a retry (ADR-0017 "Replay run"), cut by the run's abort or the
// device purge
/**
 * waits `delayMs` unless the run's `signal` or the coordination's `closed` aborts first: true when
 * the whole delay passed. every listener and the timer are released either way.
 */
export const waitUnlessAborted = (
  delayMs: number,
  signal: AbortSignal | undefined,
  closed: AbortSignal,
): Promise<boolean> =>
  new Promise((resolve) => {
    const signals = signal === undefined ? [closed] : [signal, closed];
    const release = (): void => {
      for (const watched of signals) {
        watched.removeEventListener('abort', onAbort);
      }
    };
    const onAbort = (): void => {
      clearTimeout(timer);
      release();
      resolve(false);
    };
    const timer = setTimeout(() => {
      release();
      resolve(true);
    }, delayMs);
    for (const watched of signals) {
      watched.addEventListener('abort', onAbort, { once: true });
    }
  });
