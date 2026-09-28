import { describe, expect, it, jest } from '@jest/globals';

import { FIXED_NOW, resetClock } from './fixed-clock';

const DELAY_MS = 1000;
const LATER = FIXED_NOW + 123_456_789;

// each test moves the clock away from FIXED_NOW itself, so the result does not depend on the
// order the tests run in; the setup resets the clock again before the next test
describe('resetClock', () => {
  it('moves a clock set elsewhere back to the fixed instant', () => {
    jest.setSystemTime(LATER);
    jest.advanceTimersByTime(DELAY_MS);

    expect(Date.now()).toBe(LATER + DELAY_MS);

    resetClock();

    expect(Date.now()).toBe(FIXED_NOW);
  });

  it('drops a timer left pending', () => {
    const callback = jest.fn();
    jest.advanceTimersByTime(DELAY_MS);
    setTimeout(callback, DELAY_MS);

    resetClock();

    expect(Date.now()).toBe(FIXED_NOW);
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(DELAY_MS);
    expect(callback).not.toHaveBeenCalled();
  });

  it('switches real timers back to fake ones', () => {
    jest.useRealTimers();

    resetClock();

    expect(Date.now()).toBe(FIXED_NOW);
    const callback = jest.fn();
    setTimeout(callback, DELAY_MS);
    jest.advanceTimersByTime(DELAY_MS);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
