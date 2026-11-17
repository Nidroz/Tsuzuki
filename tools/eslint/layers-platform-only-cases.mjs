// case tables for layers.test.mjs on the packages only src/platform imports: expo-crypto stays
// behind the web crypto binding the root layout installs and the random source of
// src/platform/web-crypto.ts (CONTRIBUTING.md section 4)

import { EXISTING, PROBES } from './layers-harness.mjs';
import {
  IMPORTS,
  MESSAGES,
  SYNTAX,
  allowed,
  dynamics,
  rejected,
  types,
  values,
} from './layers-cases.mjs';
import { jestCall } from './layers-test-code-cases.mjs';

const PLATFORM_ONLY = 'expo-crypto is imported only in src/platform';
const PACKAGE = 'expo-crypto';
const SUBPATH = 'expo-crypto/build/Crypto';
// the package and a subpath in the static import forms
const EVERY_IMPORT = [...values(PACKAGE, SUBPATH), ...types(PACKAGE)];

// every form on a feature, a route, the root layout (which imports the binding, never the package)
// and src/ui; one import on a file of each other entry
const FORM_FILES = [PROBES.features, EXISTING.index, EXISTING.layout, PROBES.ui];
const SAMPLES = [PROBES.nestedRoute, PROBES.featuresComponent, PROBES.uiComponent];
// src/core rejects the package with its expo group
const CORE_FILES = [PROBES.core, PROBES.hooks, PROBES.jikan, PROBES.supabase, PROBES.i18n];
// a jest test of each layer that bans the package: mocking it is loading it
const TESTS_OUTSIDE_PLATFORM = [
  PROBES.featuresTest,
  PROBES.featuresTestComponent,
  PROBES.uiTest,
  PROBES.uiTestComponent,
];
const JEST_CALLS = [jestCall('mock', PACKAGE), jestCall('requireActual', PACKAGE)];

export const REJECTED = {
  'platform-only packages outside src/platform': [
    ...FORM_FILES.flatMap((file) => [
      ...rejected(file, IMPORTS, PLATFORM_ONLY, EVERY_IMPORT),
      ...rejected(file, SYNTAX, PLATFORM_ONLY, dynamics(PACKAGE)),
    ]),
    ...rejected(SAMPLES, IMPORTS, PLATFORM_ONLY, values(PACKAGE)),
    ...rejected(CORE_FILES, IMPORTS, MESSAGES.expo, values(PACKAGE)),
    ...rejected(TESTS_OUTSIDE_PLATFORM, SYNTAX, PLATFORM_ONLY, JEST_CALLS),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'platform-only packages outside src/platform': [
    ...allowed(
      [PROBES.platform, PROBES.platformComponent],
      [...EVERY_IMPORT, ...dynamics(PACKAGE)],
    ),
    ...allowed(PROBES.platformTest, [...values(PACKAGE), ...JEST_CALLS]),
    // the test infrastructure may set the package up for jest (test/mobile, and the route tests)
    ...allowed(PROBES.testMobileComponent, [...values(PACKAGE), ...JEST_CALLS]),
  ],
};
