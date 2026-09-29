// case tables for layers.test.mjs on test code: jest module calls follow the package bans of their
// layer, and production code never imports the test infrastructure (CONTRIBUTING.md sections 4, 6)

import { EXISTING, PROBES } from './layers-harness.mjs';
import {
  MESSAGES,
  PATHS,
  SYNTAX,
  allowed,
  rejected,
  relativeFrom,
  values,
} from './layers-cases.mjs';

// every jest function that loads or mocks a module by its specifier
const JEST_MODULE_METHODS = [
  'mock',
  'doMock',
  'requireActual',
  'requireMock',
  'unstable_mockModule',
  'createMockFromModule',
];
export const JEST_IMPORT = "import { jest } from '@jest/globals';\n\n";

// probes are [label, code] pairs
export const jestCall = (method, specifier) => [
  `jest.${method}('${specifier}')`,
  `${JEST_IMPORT}jest.${method}('${specifier}');\n`,
];
const everyJestMethod = (specifier) =>
  JEST_MODULE_METHODS.map((method) => jestCall(method, specifier));
const jestMocks = (...specifiers) => specifiers.map((specifier) => jestCall('mock', specifier));

// a first argument that is not a plain string literal hides the specifier from the package bans
const SPLIT_AT = 3;
const nonLiteralForms = (specifier) => ({
  template: [`\`${specifier}\``, `\`${specifier}\``, ''],
  identifier: [`name = '${specifier}'`, 'name', `const name = '${specifier}';\n`],
  concatenation: [
    `'${specifier.slice(0, SPLIT_AT)}' + '${specifier.slice(SPLIT_AT)}'`,
    `'${specifier.slice(0, SPLIT_AT)}' + '${specifier.slice(SPLIT_AT)}'`,
    '',
  ],
  interpolation: [
    `\`\${prefix}${specifier.slice(SPLIT_AT)}\``,
    `\`\${prefix}${specifier.slice(SPLIT_AT)}\``,
    `const prefix = '${specifier.slice(0, SPLIT_AT)}';\n`,
  ],
  spread: [`...['${specifier}']`, `...['${specifier}']`, ''],
});
export const nonLiteralCall = (method, form, specifier) => {
  const [label, argument, declaration] = nonLiteralForms(specifier)[form];
  return [`jest.${method}(${label})`, `${JEST_IMPORT}${declaration}jest.${method}(${argument});\n`];
};
const nonLiteralCalls = (method, forms, specifier) =>
  forms.map((form) => nonLiteralCall(method, form, specifier));
const EVERY_FORM = ['template', 'identifier', 'concatenation', 'interpolation', 'spread'];

const CORE_TESTS = [PROBES.hooksTest, PROBES.coreTest];

// shared test helpers; test/mobile/render-router.ts and test/core/fixed-clock.ts exist on disk
const RENDER_ROUTER = 'test/mobile/render-router';
const FIXED_CLOCK = 'test/core/fixed-clock';
const importsFrom = (file, target) => values(relativeFrom(file, target));

// non-test files of app/ and src/, every layer
const PRODUCTION_FILES = [
  PROBES.features,
  PROBES.featuresComponent,
  PROBES.ui,
  PROBES.uiComponent,
  PROBES.platform,
  PROBES.srcRoot,
  EXISTING.index,
  PROBES.nestedLayout,
];

export const REJECTED = {
  'jest module calls follow the package bans': [
    ...rejected(
      PROBES.featuresTest,
      SYNTAX,
      MESSAGES.supabase,
      everyJestMethod('@supabase/supabase-js'),
    ),
    ...rejected(PROBES.featuresTest, SYNTAX, MESSAGES.nativewind, [
      jestCall('mock', 'nativewind'),
      jestCall('requireActual', 'nativewind'),
    ]),
    ...rejected(PROBES.featuresTest, SYNTAX, MESSAGES.network, jestMocks('expo/fetch')),
    ...rejected(
      PROBES.featuresTest,
      SYNTAX,
      MESSAGES.expoInternals,
      jestMocks('expo/src/winter/fetch'),
    ),
    ...rejected(CORE_TESTS, SYNTAX, MESSAGES.reactNative, [
      ...everyJestMethod('react-native'),
      ...jestMocks('react-native/Libraries/x', '@testing-library/react-native'),
    ]),
    ...rejected(CORE_TESTS, SYNTAX, MESSAGES.expo, jestMocks('expo-constants')),
    ...rejected(CORE_TESTS, SYNTAX, MESSAGES.nativewind, jestMocks('nativewind')),
    ...rejected(CORE_TESTS, SYNTAX, MESSAGES.supabase, jestMocks('@supabase/supabase-js')),
    ...rejected(PROBES.uiTest, SYNTAX, MESSAGES.supabase, jestMocks('@supabase/supabase-js')),
    ...rejected(PROBES.uiTest, SYNTAX, MESSAGES.network, jestMocks('expo/fetch')),
    ...rejected(PROBES.uiTest, SYNTAX, MESSAGES.expoInternals, [
      jestCall('requireActual', 'expo/build/winter/fetch'),
    ]),
    ...rejected(PROBES.platformTest, SYNTAX, MESSAGES.supabase, jestMocks('@supabase/supabase-js')),
    ...rejected(PROBES.platformTest, SYNTAX, MESSAGES.nativewind, [
      jestCall('requireActual', 'nativewind'),
    ]),
  ],

  'jest module calls take a string literal': [
    ...rejected(PROBES.featuresTest, SYNTAX, MESSAGES.jestLiteral, [
      ...nonLiteralCalls('mock', EVERY_FORM, '@supabase/supabase-js'),
      ...nonLiteralCalls('doMock', ['template', 'identifier'], 'nativewind'),
    ]),
    ...rejected(CORE_TESTS, SYNTAX, MESSAGES.jestLiteral, [
      ...JEST_MODULE_METHODS.map((method) => nonLiteralCall(method, 'template', 'react-native')),
      ...nonLiteralCalls('requireActual', ['identifier', 'concatenation'], 'expo-constants'),
      ...nonLiteralCalls('mock', ['interpolation'], 'react-native'),
    ]),
    ...rejected(PROBES.uiTest, SYNTAX, MESSAGES.jestLiteral, [
      ...nonLiteralCalls('requireMock', ['template', 'identifier'], '@supabase/supabase-js'),
      ...nonLiteralCalls('mock', ['concatenation'], 'expo/fetch'),
    ]),
    ...rejected(PROBES.platformTest, SYNTAX, MESSAGES.jestLiteral, [
      ...nonLiteralCalls('unstable_mockModule', ['template'], 'nativewind'),
      ...nonLiteralCalls('createMockFromModule', ['identifier'], '@supabase/supabase-js'),
      ...nonLiteralCalls('mock', ['concatenation'], 'nativewind'),
    ]),
  ],

  'production code never imports test/': [
    ...PRODUCTION_FILES.flatMap((file) =>
      rejected(file, PATHS, MESSAGES.testInfrastructure, importsFrom(file, RENDER_ROUTER)),
    ),
    ...[PROBES.core, PROBES.hooks, PROBES.hooksComponent].flatMap((file) =>
      rejected(file, PATHS, MESSAGES.testInfrastructure, importsFrom(file, FIXED_CLOCK)),
    ),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'jest module calls follow the package bans': [
    ...allowed(PROBES.featuresTest, [
      ...everyJestMethod('@core/hooks/x'),
      ...jestMocks('react-native', 'expo-router'),
      // only jest itself loads modules: another object's mock() is an ordinary call
      [
        "other.mock('@supabase/supabase-js')",
        "const other = { mock: (name: string) => name };\nother.mock('@supabase/supabase-js');\n",
      ],
    ]),
    ...allowed(PROBES.uiTest, jestMocks('react-native', 'nativewind')),
    ...allowed(PROBES.platformTest, jestMocks('react-native', 'expo-secure-store')),
    ...allowed(CORE_TESTS, jestMocks('@core/domain/x')),
  ],

  'jest module calls take a string literal': [
    ...allowed(
      [PROBES.featuresTest, ...CORE_TESTS, PROBES.uiTest, PROBES.platformTest],
      [
        // plain string literals are covered by the package ban controls above; these are the other
        // jest calls and the other objects that must stay unaffected
        ['jest.fn()', `${JEST_IMPORT}export const probe = jest.fn();\n`],
        ['jest.useFakeTimers()', `${JEST_IMPORT}jest.useFakeTimers();\n`],
        [
          "jest.mock('@core/domain/x', factory)",
          `${JEST_IMPORT}jest.mock('@core/domain/x', () => ({ probe: jest.fn() }));\n`,
        ],
        [
          "jest.requireActual<Probe>('@core/domain/x')",
          `${JEST_IMPORT}type Probe = { probe: number };\n` +
            "export const actual = jest.requireActual<Probe>('@core/domain/x');\n",
        ],
        [
          'other.mock(name)',
          "const other = { mock: (name: string) => name };\nconst name = 'react-native';\n" +
            'other.mock(name);\n',
        ],
      ],
    ),
  ],

  'production code never imports test/': [
    // colocated tests use the test infrastructure
    ...[PROBES.featuresTest, PROBES.uiTest, PROBES.uiTestComponent, PROBES.platformTest].flatMap(
      (file) => allowed(file, importsFrom(file, RENDER_ROUTER)),
    ),
    ...allowed(PROBES.hooksTest, importsFrom(PROBES.hooksTest, FIXED_CLOCK)),
    // test/ itself is unaffected
    ...allowed(PROBES.testMobileComponent, importsFrom(PROBES.testMobileComponent, RENDER_ROUTER)),
    ...allowed(PROBES.coreTestSource, importsFrom(PROBES.coreTestSource, FIXED_CLOCK)),
  ],
};
