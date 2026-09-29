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
const JEST_IMPORT = "import { jest } from '@jest/globals';\n\n";

// probes are [label, code] pairs
const jestCall = (method, specifier) => [
  `jest.${method}('${specifier}')`,
  `${JEST_IMPORT}jest.${method}('${specifier}');\n`,
];
const everyJestMethod = (specifier) =>
  JEST_MODULE_METHODS.map((method) => jestCall(method, specifier));
const jestMocks = (...specifiers) => specifiers.map((specifier) => jestCall('mock', specifier));

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

  'production code never imports test/': [
    // colocated tests use the test infrastructure
    ...[PROBES.featuresTest, PROBES.uiTest, PROBES.platformTest].flatMap((file) =>
      allowed(file, importsFrom(file, RENDER_ROUTER)),
    ),
    ...allowed(PROBES.hooksTest, importsFrom(PROBES.hooksTest, FIXED_CLOCK)),
    // test/ itself is unaffected
    ...allowed(PROBES.testMobileComponent, importsFrom(PROBES.testMobileComponent, RENDER_ROUTER)),
    ...allowed(PROBES.coreTestSource, importsFrom(PROBES.coreTestSource, FIXED_CLOCK)),
  ],
};
