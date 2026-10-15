import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';

import { useDebouncedValue } from './use-debounced-value';

const DELAY_MS = 400;

interface Props {
  readonly value: string;
}

const renderDebounced = (value: string) =>
  renderHook(({ value: current }: Props) => useDebouncedValue(current, DELAY_MS), {
    initialProps: { value },
  });

const advance = (ms: number) => {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
};

describe('useDebouncedValue', () => {
  it('returns the first value at once', () => {
    const { result } = renderDebounced('fri');

    expect(result.current).toBe('fri');
  });

  it('returns a new value once it stayed unchanged for the delay', () => {
    const { result, rerender } = renderDebounced('f');

    rerender({ value: 'fr' });
    advance(DELAY_MS - 1);

    expect(result.current).toBe('f');

    advance(1);

    expect(result.current).toBe('fr');
  });

  it('restarts the delay on each change and skips the intermediate values', () => {
    const { result, rerender } = renderDebounced('f');

    rerender({ value: 'fr' });
    advance(DELAY_MS - 1);
    rerender({ value: 'fri' });
    advance(DELAY_MS - 1);

    expect(result.current).toBe('f');

    advance(1);

    expect(result.current).toBe('fri');
  });

  it('clears its timer on unmount', () => {
    const { rerender, unmount } = renderDebounced('f');
    rerender({ value: 'fr' });

    expect(jest.getTimerCount()).toBe(1);

    unmount();

    expect(jest.getTimerCount()).toBe(0);
  });
});
