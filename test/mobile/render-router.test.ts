import { describe, expect, it } from '@jest/globals';

import { assertThenable, NOT_THENABLE_MESSAGE } from './render-router';

// a synchronous render result: the router getters without a then method
const SYNC_RENDER = { getPathname: () => '/' };

describe('assertThenable', () => {
  it('accepts a promise', () => {
    expect(() => {
      assertThenable(Promise.resolve());
    }).not.toThrow();
  });

  it('accepts an object with a then method', () => {
    expect(() => {
      assertThenable({ ...SYNC_RENDER, then: () => undefined });
    }).not.toThrow();
  });

  it.each([
    ['a synchronous render result', SYNC_RENDER],
    ['an object whose then is not a function', { then: 1 }],
    ['undefined', undefined],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(() => {
      assertThenable(value);
    }).toThrow(new TypeError(NOT_THENABLE_MESSAGE));
  });
});
