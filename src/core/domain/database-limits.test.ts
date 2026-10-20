import { describe, expect, it } from '@jest/globals';

import { POSTGRES_INTEGER_MAX } from './database-limits';

describe('POSTGRES_INTEGER_MAX', () => {
  it('is the largest signed 32-bit integer', () => {
    expect(POSTGRES_INTEGER_MAX).toBe(2 ** 31 - 1);
  });

  it('is a safe integer', () => {
    expect(Number.isSafeInteger(POSTGRES_INTEGER_MAX)).toBe(true);
  });
});
