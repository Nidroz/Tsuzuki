import { beforeEach, jest } from '@jest/globals';

// every test starts at this instant, whatever the previous test did with the clock
export const FIXED_NOW = Date.UTC(2026, 0, 1);

const installFakeTimers = (): void => {
  jest.useFakeTimers({ now: FIXED_NOW });
};

// the config enables fake timers once per file: reinstalling them before each test resets the
// clock, drops timers left pending by the previous test and undoes a switch to real timers.
// the first call covers code that runs while the test file is imported
export const pinClockPerTest = (): void => {
  installFakeTimers();
  beforeEach(installFakeTimers);
};
