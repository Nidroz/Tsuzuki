import { describe, expect, it } from '@jest/globals';

import { FUNCTION_ERROR_CODES } from '../../../src/core/repositories/supabase/account-deletion';
import { RESPONSES } from './handler';

// the client reports the fixed error code of a failed deletion only when it knows it
// (FUNCTION_ERROR_CODES in src/core/repositories/supabase/account-deletion.ts): its copy must name
// exactly the codes of the function's bodies. src/core cannot import an edge function, so the
// comparison lives here, next to the function

// the error code of each body of the function, in its table order
const functionErrorCodes = (): string[] =>
  Object.values(RESPONSES).flatMap(({ body }) => ('error' in body ? [body.error] : []));

describe('delete-account error codes', () => {
  it("keeps the client's copy equal to the function's error codes", () => {
    expect([...FUNCTION_ERROR_CODES].sort()).toStrictEqual(functionErrorCodes().sort());
  });

  it('names each error answer of the function by its body code, once', () => {
    const errorOutcomes = Object.entries(RESPONSES).flatMap(([outcome, { body }]) =>
      'error' in body ? [[outcome, body.error]] : [],
    );

    for (const [outcome, code] of errorOutcomes) {
      expect(outcome).toBe(code);
    }
    expect(new Set(functionErrorCodes()).size).toBe(errorOutcomes.length);
  });
});
