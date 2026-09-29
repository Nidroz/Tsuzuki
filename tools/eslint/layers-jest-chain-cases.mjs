// case tables for layers.test.mjs on the jest object handed out again: a jest method that returns
// jest lets the next call in a chain reach a module method on a call result instead of on jest,
// and a re-export of '@jest/globals' hands jest to another module, both out of reach of the module
// call guards (CONTRIBUTING.md sections 4, 6)

import { MESSAGES, SYNTAX, allowed, rejected } from './layers-cases.mjs';
import { JEST_TESTS } from './layers-jest-cases.mjs';
import { JEST_IMPORT } from './layers-test-code-cases.mjs';

// probes are [label, code] pairs. the jest methods typed as returning jest in jest 29
// (@jest/environment): autoMockOff, autoMockOn, clearAllMocks, deepUnmock, disableAutomock, doMock,
// dontMock, enableAutomock, isolateModules, mock, resetAllMocks, resetModules, restoreAllMocks,
// retryTimes, setMock, setTimeout, unmock, unstable_mockModule, useFakeTimers, useRealTimers; a
// representative subset, banned module calls first, then harmless chains
const CHAINED_MODULE_CALLS = [
  [
    "jest.resetModules().doMock('@supabase/supabase-js', ...)",
    `${JEST_IMPORT}jest.resetModules().doMock('@supabase/supabase-js', () => ({}));\n`,
  ],
  [
    "jest.resetModules().requireActual('@supabase/supabase-js')",
    `${JEST_IMPORT}export const actual: unknown = jest\n` +
      "  .resetModules()\n  .requireActual('@supabase/supabase-js');\n",
  ],
  [
    "jest.mock('@core/domain/x').mock('@supabase/supabase-js')",
    `${JEST_IMPORT}jest.mock('@core/domain/x').mock('@supabase/supabase-js');\n`,
  ],
  [
    "jest.useFakeTimers().mock('react-native')",
    `${JEST_IMPORT}jest.useFakeTimers().mock('react-native');\n`,
  ],
  [
    'jest.resetModules().mock(`@supabase/supabase-js`)',
    `${JEST_IMPORT}jest.resetModules().mock(\`@supabase/supabase-js\`);\n`,
  ],
  [
    "jest.resetModules()?.mock('@supabase/supabase-js')",
    `${JEST_IMPORT}jest.resetModules()?.mock('@supabase/supabase-js');\n`,
  ],
  [
    "jest.resetModules()['mock']('@supabase/supabase-js')",
    `${JEST_IMPORT}jest.resetModules()['mock']('@supabase/supabase-js');\n`,
  ],
  [
    "jest.isolateModules(() => {}).unmock('@supabase/supabase-js')",
    `${JEST_IMPORT}jest.isolateModules(() => {}).unmock('@supabase/supabase-js');\n`,
  ],
  [
    "jest.setTimeout(1).setMock('@supabase/supabase-js', {})",
    `${JEST_IMPORT}jest.setTimeout(1).setMock('@supabase/supabase-js', {});\n`,
  ],
  [
    "jest.retryTimes(1).unstable_mockModule('@supabase/supabase-js', ...)",
    `${JEST_IMPORT}jest.retryTimes(1).unstable_mockModule('@supabase/supabase-js', () => ({}));\n`,
  ],
  [
    "jest.enableAutomock().dontMock('@supabase/supabase-js')",
    `${JEST_IMPORT}jest.enableAutomock().dontMock('@supabase/supabase-js');\n`,
  ],
  // one wrapper between the returned jest and the member read on it, one case per wrapper node
  [
    "(jest.resetModules?.()).mock('@supabase/supabase-js')",
    `${JEST_IMPORT}(jest.resetModules?.()).mock('@supabase/supabase-js');\n`,
  ],
  [
    "jest.resetModules()!.mock('@supabase/supabase-js')",
    `${JEST_IMPORT}jest.resetModules()!.mock('@supabase/supabase-js');\n`,
  ],
  [
    "(jest.resetModules() as typeof jest).mock('@supabase/supabase-js')",
    `${JEST_IMPORT}(jest.resetModules() as typeof jest).mock('@supabase/supabase-js');\n`,
  ],
  [
    "(jest.resetModules() satisfies typeof jest).mock('@supabase/supabase-js')",
    `${JEST_IMPORT}(jest.resetModules() satisfies typeof jest).mock('@supabase/supabase-js');\n`,
  ],
  // an angle-bracket assertion parses in the .ts probes only, not in .tsx
  [
    "(<typeof jest>jest.resetModules()).mock('@supabase/supabase-js')",
    `${JEST_IMPORT}(<typeof jest>jest.resetModules()).mock('@supabase/supabase-js');\n`,
  ],
];
// any member access on a returned jest is rejected, whatever the method read on it
const HARMLESS_CHAINS = [
  ['jest.useRealTimers().clearAllMocks()', `${JEST_IMPORT}jest.useRealTimers().clearAllMocks();\n`],
  [
    'jest.clearAllMocks().resetAllMocks().restoreAllMocks()',
    `${JEST_IMPORT}jest.clearAllMocks().resetAllMocks().restoreAllMocks();\n`,
  ],
  ['jest.autoMockOff().fn', `${JEST_IMPORT}export const probe: unknown = jest.autoMockOff().fn;\n`],
];

// a re-export of every name hands jest out under a name the guards do not follow
const REEXPORTS = [
  ["export * from '@jest/globals'", "export * from '@jest/globals';\n"],
  ["export * as g from '@jest/globals'", "export * as g from '@jest/globals';\n"],
  ["export { 'jest' as j } from '@jest/globals'", "export { 'jest' as j } from '@jest/globals';\n"],
];

export const REJECTED = {
  'jest methods are not chained on a returned jest': rejected(
    JEST_TESTS,
    SYNTAX,
    MESSAGES.jestByName,
    [...CHAINED_MODULE_CALLS, ...HARMLESS_CHAINS],
  ),

  'jest is not re-exported by a test module': rejected(
    JEST_TESTS,
    SYNTAX,
    MESSAGES.jestName,
    REEXPORTS,
  ),
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'jest methods are not chained on a returned jest': allowed(JEST_TESTS, [
    // a mock function, a spy or a module value is no jest object
    [
      'jest.mocked(f).mock.calls',
      `${JEST_IMPORT}const f = jest.fn();\nexport const calls = jest.mocked(f).mock.calls;\n`,
    ],
    [
      'jest.fn().mockReturnValue(1)',
      `${JEST_IMPORT}export const probe = jest.fn().mockReturnValue(1);\n`,
    ],
    [
      "jest.spyOn(o, 'm').mockImplementation(() => 1)",
      `${JEST_IMPORT}const o = { m: () => 1 };\njest.spyOn(o, 'm').mockImplementation(() => 1);\n`,
    ],
    [
      "jest.resetModules(); jest.doMock('@core/domain/x')",
      `${JEST_IMPORT}jest.resetModules();\njest.doMock('@core/domain/x');\n`,
    ],
    [
      "jest.requireActual<typeof import('@core/domain/x')>('@core/domain/x').value",
      `${JEST_IMPORT}export const value: unknown = jest.requireActual<\n` +
        "  typeof import('@core/domain/x')\n>('@core/domain/x').value;\n",
    ],
  ]),

  'jest is not re-exported by a test module': allowed(JEST_TESTS, [
    ["export { expect } from '@jest/globals'", "export { expect } from '@jest/globals';\n"],
  ]),
};
