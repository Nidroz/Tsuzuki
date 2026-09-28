import { afterAll, afterEach } from '@jest/globals';

const FAILING_METHODS = ['error', 'warn'] as const;
const STACK_FRAMES_START = '\n    at ';

const describeArgument = (argument: unknown): string => {
  if (typeof argument === 'string') {
    return argument;
  }
  if (argument instanceof Error) {
    return argument.stack ?? argument.message;
  }
  try {
    return JSON.stringify(argument);
  } catch {
    return Object.prototype.toString.call(argument);
  }
};

export interface ConsoleCheckHooks {
  afterEach: (check: () => void) => void;
  afterAll: (check: () => void) => void;
}

// tests of the wiring pass their own hooks
const JEST_HOOKS: ConsoleCheckHooks = { afterEach, afterAll };

// one error per call, created where the message was logged so the failure points there
const unexpectedCalls: Error[] = [];

/** returns and forgets the messages recorded since the last call */
export const takeUnexpectedConsoleMessages = (): string[] =>
  unexpectedCalls.splice(0).map(({ message }) => message);

/** throws the messages recorded since the last call and forgets them: the next test starts clean */
export const assertNoUnexpectedMessage = (): void => {
  const [first, ...others] = unexpectedCalls.splice(0);
  if (!first) {
    return;
  }
  const failure = new Error([first, ...others].map(({ message }) => message).join('\n'));
  // the first frame is the console replacement below: the stack starts at its caller
  const stack = first.stack ?? '';
  const callerFrames = stack.indexOf(STACK_FRAMES_START, stack.indexOf(STACK_FRAMES_START) + 1);
  if (callerFrames !== -1) {
    failure.stack = `Error: ${failure.message}${stack.slice(callerFrames)}`;
  }
  throw failure;
};

// console.error and console.warn fail the running test. calls are recorded and checked after the
// test instead of thrown on the spot: libraries catch errors thrown from a console call (msw turns
// one into a 500 response), which would hide the failure. an expected message is asserted with
// jest.spyOn(console, method), which is restored after each test
export const failOnConsole = (hooks: ConsoleCheckHooks = JEST_HOOKS): void => {
  for (const method of FAILING_METHODS) {
    console[method] = (...args: unknown[]) => {
      unexpectedCalls.push(
        new Error(`unexpected console.${method}: ${args.map(describeArgument).join(' ')}`),
      );
    };
  }
  // these hooks run before the hooks a test file declares at its top level: a call made in such an
  // afterEach fails the next test, and a call made in such an afterAll is not caught
  hooks.afterEach(assertNoUnexpectedMessage);
  // catches calls made after the last test's check, e.g. by the testing library's cleanup
  hooks.afterAll(assertNoUnexpectedMessage);
};
