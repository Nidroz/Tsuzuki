import { describe, expect, it, jest } from '@jest/globals';

import {
  assertNoUnexpectedMessage,
  type ConsoleCheckHooks,
  failOnConsole,
  takeUnexpectedConsoleMessages,
} from './fail-on-console';

const THIS_FILE = 'fail-on-console.test.ts';

// the setup runs assertNoUnexpectedMessage after each test: these tests call it themselves and
// leave nothing recorded, so that check passes
describe('assertNoUnexpectedMessage', () => {
  it('does not throw when nothing was recorded', () => {
    expect(assertNoUnexpectedMessage).not.toThrow();
  });

  it('throws on an unexpected console.error and forgets it', () => {
    console.error('boom', { code: 1 });

    expect(assertNoUnexpectedMessage).toThrow('unexpected console.error: boom {"code":1}');
    expect(takeUnexpectedConsoleMessages()).toStrictEqual([]);
    expect(assertNoUnexpectedMessage).not.toThrow();
  });

  it('throws on an unexpected console.warn and forgets it', () => {
    console.warn('careful');

    expect(assertNoUnexpectedMessage).toThrow('unexpected console.warn: careful');
    expect(takeUnexpectedConsoleMessages()).toStrictEqual([]);
  });

  it('reports every recorded message in one failure', () => {
    console.warn('first');
    console.error('second');

    expect(assertNoUnexpectedMessage).toThrow(
      'unexpected console.warn: first\nunexpected console.error: second',
    );
  });

  it('points the failure at the line that logged the message', () => {
    console.error('located');

    let failure: unknown;
    try {
      assertNoUnexpectedMessage();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    const stack = failure instanceof Error ? (failure.stack ?? '') : '';
    const [header, firstFrame] = stack.split('\n');
    expect(header).toBe('Error: unexpected console.error: located');
    expect(firstFrame).toContain(THIS_FILE);
  });
});

describe('failOnConsole', () => {
  it('runs the check after each test and after the last one', () => {
    const hooks = {
      afterEach: jest.fn<ConsoleCheckHooks['afterEach']>(),
      afterAll: jest.fn<ConsoleCheckHooks['afterAll']>(),
    };
    // the spies put back the setup's console replacements after this test
    jest.spyOn(console, 'error');
    jest.spyOn(console, 'warn');

    failOnConsole(hooks);

    expect(hooks.afterEach).toHaveBeenCalledTimes(1);
    expect(hooks.afterEach).toHaveBeenCalledWith(assertNoUnexpectedMessage);
    expect(hooks.afterAll).toHaveBeenCalledTimes(1);
    expect(hooks.afterAll).toHaveBeenCalledWith(assertNoUnexpectedMessage);
  });

  it('records console.error and console.warn for the check', () => {
    jest.spyOn(console, 'error');
    jest.spyOn(console, 'warn');
    failOnConsole({ afterEach: jest.fn(), afterAll: jest.fn() });

    console.error('boom');
    console.warn('careful');

    expect(assertNoUnexpectedMessage).toThrow(
      'unexpected console.error: boom\nunexpected console.warn: careful',
    );
  });
});
