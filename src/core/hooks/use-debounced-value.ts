import { useEffect, useState } from 'react';

/**
 * `value` once it has stayed unchanged for `delayMs`: each change restarts the delay. the first
 * value is returned at once; the timer is cleared on unmount
 */
export const useDebouncedValue = <T>(value: T, delayMs: number): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
};
