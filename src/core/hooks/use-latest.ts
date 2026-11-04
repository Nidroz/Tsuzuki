import { useLayoutEffect, useRef } from 'react';

/**
 * a ref holding `value` as of the last commit: an async callback reads it after an await to act
 * on the latest value, never on the one of the render that started it
 */
export const useLatest = <T>(value: T): { readonly current: T } => {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
};
