// case tables for layers.test.mjs on the jest module call guards: jest is imported under its own
// name and its methods are called by name, every module method follows the package bans, the
// literal rule and the canonical paths, so no test loads or mocks a module the guards cannot see
// (CONTRIBUTING.md sections 4, 6)

import { PROBES } from './layers-harness.mjs';
import { MESSAGES, SYNTAX, allowed, dynamics, rejected } from './layers-cases.mjs';
import { JEST_IMPORT, jestCall } from './layers-test-code-cases.mjs';

// every colocated or test/core jest test inside the layers
export const JEST_TESTS = [
  PROBES.featuresTest,
  PROBES.hooksTest,
  PROBES.coreTest,
  PROBES.uiTest,
  PROBES.platformTest,
];

// the module methods besides mock, doMock, requireActual, requireMock, unstable_mockModule and
// createMockFromModule (layers-test-code-cases.mjs); setMock takes the module exports as well
const EXTRA_MODULE_METHODS = [
  'unmock',
  'deepUnmock',
  'dontMock',
  'setMock',
  'unstable_unmockModule',
];
const extraCall = (method, argument) => {
  const rest = method === 'setMock' ? ', {}' : '';
  return [
    `jest.${method}(${argument}${rest})`,
    `${JEST_IMPORT}jest.${method}(${argument}${rest});\n`,
  ];
};
const extraCalls = (specifier) =>
  EXTRA_MODULE_METHODS.map((method) => extraCall(method, `'${specifier}'`));

// probes are [label, code] pairs; a harmless specifier keeps the renamed or computed access the only
// thing a case can be reported for
const RENAMED_IMPORTS = [
  [
    "import { jest as j } + j.mock('@core/domain/x')",
    "import { jest as j } from '@jest/globals';\n\nj.mock('@core/domain/x');\n",
  ],
  [
    'import { expect, jest as mocks } + mocks.fn()',
    "import { expect, jest as mocks } from '@jest/globals';\n\n" +
      'expect(mocks.fn()).toBeDefined();\n',
  ],
];
// a namespace or default import, a string import name or a module value hands out jest under
// another name
const HIDDEN_IMPORTS = [
  [
    "import * as g from '@jest/globals' + g.jest.fn()",
    "import * as g from '@jest/globals';\n\nexport const probe = g.jest.fn();\n",
  ],
  ["import g from '@jest/globals'", "import g from '@jest/globals';\n\nexport const probe = g;\n"],
  [
    "import { 'jest' as j } + j.fn()",
    "import { 'jest' as j } from '@jest/globals';\n\nexport const probe = j.fn();\n",
  ],
  ["import('@jest/globals')", "export const load = () => import('@jest/globals');\n"],
  [
    "jest.requireActual('@jest/globals')",
    `${JEST_IMPORT}export const globals: unknown = jest.requireActual('@jest/globals');\n`,
  ],
  [
    "jest.requireMock('@jest/globals')",
    `${JEST_IMPORT}export const globals: unknown = jest.requireMock('@jest/globals');\n`,
  ],
];
// jest read on a global object, however its name is spelled statically
const GLOBAL_OBJECTS = ['globalThis', 'global', 'window', 'self'];
const GLOBAL_JEST = [
  ...GLOBAL_OBJECTS.map((object) => [
    `${object}.jest.mock(...)`,
    `${object}.jest.mock('@core/domain/x');\n`,
  ]),
  ["globalThis['jest']", "export const probe: unknown = globalThis['jest'];\n"],
  ['globalThis[`jest`]', 'export const probe: unknown = globalThis[`jest`];\n'],
  ['globalThis?.jest', 'export const probe: unknown = globalThis?.jest;\n'],
];
const COMPUTED_ACCESS = [
  [
    "jest['mock']('@supabase/supabase-js')",
    `${JEST_IMPORT}jest['mock']('@supabase/supabase-js');\n`,
  ],
  ['jest[`requireActual`](...)', `${JEST_IMPORT}jest[\`requireActual\`]('@core/domain/x');\n`],
  [
    'jest[method](...), method = mock',
    `${JEST_IMPORT}const method = 'mock';\njest[method]('@supabase/supabase-js');\n`,
  ],
];
const JEST_AS_VALUE = [
  ['const j = jest', `${JEST_IMPORT}const j = jest;\nj.requireActual('@supabase/supabase-js');\n`],
  [
    'const { requireActual } = jest',
    `${JEST_IMPORT}const { requireActual } = jest;\n` +
      "export const actual: unknown = requireActual('@core/domain/x');\n",
  ],
  ['helper(jest)', `${JEST_IMPORT}const helper = (value: unknown) => value;\nhelper(jest);\n`],
];
// a module method read as a value is called without the guards seeing its first argument
const MODULE_METHOD_AS_VALUE = [
  ['jest.mock.call(jest, ...)', `${JEST_IMPORT}jest.mock.call(jest, '@supabase/supabase-js');\n`],
  [
    'jest.requireActual.bind(jest)(...)',
    `${JEST_IMPORT}jest.requireActual.bind(jest)('@supabase/supabase-js');\n`,
  ],
  ['(0, jest.mock)(...)', `${JEST_IMPORT}(0, jest.mock)('@supabase/supabase-js');\n`],
];

export const REJECTED = {
  'jest is imported under its own name': rejected(
    JEST_TESTS,
    SYNTAX,
    MESSAGES.jestName,
    RENAMED_IMPORTS,
  ),

  'jest is never reached through a module value or a global object': rejected(
    JEST_TESTS,
    SYNTAX,
    MESSAGES.jestName,
    [...HIDDEN_IMPORTS, ...GLOBAL_JEST],
  ),

  'jest methods are called by name': [
    ...rejected(JEST_TESTS, SYNTAX, MESSAGES.jestByName, COMPUTED_ACCESS),
    ...rejected(JEST_TESTS, SYNTAX, MESSAGES.jestByName, JEST_AS_VALUE),
    ...rejected(
      [PROBES.featuresTest, PROBES.uiTest],
      SYNTAX,
      MESSAGES.jestByName,
      MODULE_METHOD_AS_VALUE,
    ),
  ],

  // already reported: an optional call is still a call by name
  'jest optional calls follow the package bans': rejected(
    PROBES.featuresTest,
    SYNTAX,
    MESSAGES.supabase,
    [
      [
        "jest?.mock('@supabase/supabase-js')",
        `${JEST_IMPORT}jest?.mock('@supabase/supabase-js');\n`,
      ],
    ],
  ),

  'jest module calls are written canonically': [
    ...rejected(PROBES.featuresTest, SYNTAX, MESSAGES.canonical, [
      jestCall('requireActual', '../../node_modules/@supabase/supabase-js'),
      jestCall('mock', '@core/../features/x'),
      jestCall('mock', 'node_modules/expo/fetch'),
    ]),
    ...rejected(PROBES.hooksTest, SYNTAX, MESSAGES.canonical, [
      jestCall('requireActual', '../../../node_modules/react-native'),
    ]),
    ...rejected(PROBES.coreTest, SYNTAX, MESSAGES.canonical, [
      jestCall('mock', '@core/../platform/x'),
    ]),
  ],

  'every jest module method follows the layer rules': [
    ...rejected(
      PROBES.featuresTest,
      SYNTAX,
      MESSAGES.supabase,
      extraCalls('@supabase/supabase-js'),
    ),
    ...rejected(PROBES.uiTest, SYNTAX, MESSAGES.network, [extraCall('unmock', "'expo/fetch'")]),
    ...rejected([PROBES.hooksTest, PROBES.coreTest], SYNTAX, MESSAGES.reactNative, [
      ...extraCalls('react-native'),
    ]),
    ...rejected(
      [PROBES.hooksTest, PROBES.coreTest],
      SYNTAX,
      MESSAGES.jestLiteral,
      EXTRA_MODULE_METHODS.map((method) => extraCall(method, '`react-native`')),
    ),
    ...rejected(PROBES.featuresTest, SYNTAX, MESSAGES.jestLiteral, [
      [
        'jest.unmock(name), name = @supabase/supabase-js',
        `${JEST_IMPORT}const name = '@supabase/supabase-js';\njest.unmock(name);\n`,
      ],
    ]),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'jest is imported under its own name': allowed(JEST_TESTS, [
    ['import { jest }', `${JEST_IMPORT}jest.mock('@core/domain/x');\n`],
    [
      "import { expect, jest } + jest.mock('@core/domain/x')",
      "import { expect, jest } from '@jest/globals';\n\njest.mock('@core/domain/x');\n" +
        'expect(jest.fn()).toBeDefined();\n',
    ],
  ]),

  'jest is never reached through a module value or a global object': [
    // src/ui and src/platform do not load src/core at run time: a sibling module instead
    ...allowed(
      [PROBES.featuresTest, PROBES.hooksTest, PROBES.coreTest],
      dynamics('@core/domain/x'),
    ),
    ...allowed([PROBES.uiTest, PROBES.platformTest], dynamics('./x')),
    ...allowed(JEST_TESTS, [
      [
        'import { jest, expect } + jest.fn()',
        "import { jest, expect } from '@jest/globals';\n\nexpect(jest.fn()).toBeDefined();\n",
      ],
      [
        "jest.requireActual('@core/domain/x')",
        `${JEST_IMPORT}export const actual: unknown = jest.requireActual('@core/domain/x');\n`,
      ],
      // jest on a non-global object, and another name on a global object
      [
        "other.jest, other['jest']",
        'const other = { jest: 1 };\n' + "export const probe = [other.jest, other['jest']];\n",
      ],
      ['globalThis.jester', 'export const probe: unknown = globalThis.jester;\n'],
    ]),
  ],

  'jest methods are called by name': allowed(JEST_TESTS, [
    ['jest.fn()', `${JEST_IMPORT}export const probe = jest.fn();\n`],
    ['jest.useFakeTimers()', `${JEST_IMPORT}jest.useFakeTimers();\n`],
    ["jest.spyOn(obj, 'm')", `${JEST_IMPORT}const obj = { m: () => 1 };\njest.spyOn(obj, 'm');\n`],
    [
      'expect(jest.isMockFunction(f))',
      "import { expect, jest } from '@jest/globals';\n\nconst f = jest.fn();\n" +
        'expect(jest.isMockFunction(f)).toBe(true);\n',
    ],
    ['typeof jest.fn', `${JEST_IMPORT}export type MockFn = ReturnType<typeof jest.fn>;\n`],
    // another object's computed or aliased methods are ordinary code
    [
      "other['mock'](...)",
      'const other = { mock: (name: string) => name };\nconst alias = other;\n' +
        "other['mock']('@supabase/supabase-js');\nalias.mock('@supabase/supabase-js');\n",
    ],
  ]),

  'jest optional calls follow the package bans': allowed(PROBES.featuresTest, [
    ["jest?.mock('@core/domain/x')", `${JEST_IMPORT}jest?.mock('@core/domain/x');\n`],
  ]),

  'jest module calls are written canonically': [
    ...allowed(PROBES.featuresTest, [
      jestCall('requireActual', '../../test/mobile/render-router'),
      jestCall('mock', '@core/hooks/x'),
    ]),
    ...allowed(PROBES.hooksTest, [jestCall('requireActual', '../../../test/core/fixed-clock')]),
  ],

  'every jest module method follows the layer rules': [
    ...allowed(JEST_TESTS, extraCalls('@core/domain/x')),
    ...allowed([PROBES.uiTest, PROBES.platformTest], extraCalls('react-native')),
  ],
};
