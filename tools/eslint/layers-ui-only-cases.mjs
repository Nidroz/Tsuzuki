// case tables for layers.test.mjs on the packages only src/ui imports: expo-image and
// @shopify/flash-list stay behind the CoverImage and List primitives, so a cover only ever renders
// the url a catalog item holds (docs/ARCHITECTURE.md section 2, CONTRIBUTING.md section 4)

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

const UI_ONLY = 'expo-image and @shopify/flash-list are imported only in src/ui';
const PACKAGES = ['expo-image', '@shopify/flash-list'];
const SUBPATHS = ['expo-image/build/Image', '@shopify/flash-list/jestSetup'];
// the packages and their subpaths in the static import forms
const EVERY_IMPORT = [...values(...PACKAGES, ...SUBPATHS), ...types(...PACKAGES)];

// every form on a feature, a route and src/platform (the layer with type-only patterns); one import
// and one import() on a file of each other entry outside src/ui. in src/core the expo group also
// rejects expo-image, so flash-list proves the group there
const FORM_FILES = [PROBES.features, EXISTING.index, PROBES.platform];
const SCREEN_SAMPLES = [PROBES.nestedRoute, EXISTING.layout, PROBES.featuresComponent];
const CORE_FILES = [
  PROBES.core,
  PROBES.hooks,
  PROBES.hooksComponent,
  PROBES.coreTest,
  PROBES.jikan,
  PROBES.supabase,
  PROBES.i18n,
];
// a jest test of each layer that bans the packages: mocking one is loading it
const TESTS_OUTSIDE_UI = [
  PROBES.featuresTest,
  PROBES.featuresTestComponent,
  PROBES.platformTest,
  PROBES.hooksTest,
];

export const REJECTED = {
  'ui-only packages outside src/ui': [
    ...FORM_FILES.flatMap((file) => [
      ...rejected(file, IMPORTS, UI_ONLY, EVERY_IMPORT),
      ...rejected(file, SYNTAX, UI_ONLY, dynamics(...PACKAGES)),
    ]),
    ...SCREEN_SAMPLES.flatMap((file) => [
      ...rejected(file, IMPORTS, UI_ONLY, values('expo-image')),
      ...rejected(file, SYNTAX, UI_ONLY, dynamics('@shopify/flash-list')),
    ]),
    ...CORE_FILES.flatMap((file) => [
      ...rejected(file, IMPORTS, UI_ONLY, values('@shopify/flash-list')),
      ...rejected(file, SYNTAX, UI_ONLY, dynamics('@shopify/flash-list')),
      ...rejected(file, IMPORTS, MESSAGES.expo, values('expo-image')),
    ]),
    ...rejected(TESTS_OUTSIDE_UI, SYNTAX, UI_ONLY, [
      jestCall('mock', 'expo-image'),
      jestCall('requireActual', '@shopify/flash-list'),
    ]),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'ui-only packages outside src/ui': [
    ...allowed([PROBES.ui, PROBES.uiComponent], [...EVERY_IMPORT, ...dynamics(...PACKAGES)]),
    ...allowed(
      [PROBES.uiTest, PROBES.uiTestComponent],
      [
        ...values(...PACKAGES),
        jestCall('mock', 'expo-image'),
        jestCall('requireActual', '@shopify/flash-list'),
      ],
    ),
    // the test infrastructure may set the packages up for jest (test/mobile/setup.ts)
    ...allowed(PROBES.testMobileComponent, values(...PACKAGES)),
  ],
};
