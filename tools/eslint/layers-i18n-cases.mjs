// case tables for layers.test.mjs on the i18n libraries: i18next and react-i18next are imported only
// in src/core/i18n, its co-located tests included; every other file, whatever its layer, translates
// through @core/i18n (CONTRIBUTING.md section 4)

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

const I18N_PACKAGES = ['i18next', 'react-i18next'];
const I18N_SUBPATHS = ['i18next/x', 'react-i18next/x'];
const PUBLIC_API = '@core/i18n/index';

// probes are [label, code] pairs
const reExports = (...specifiers) =>
  specifiers.flatMap((s) => [
    [`export { probe } from '${s}'`, `export { probe } from '${s}';\n`],
    [`export type { Probe } from '${s}'`, `export type { Probe } from '${s}';\n`],
    [`export * from '${s}'`, `export * from '${s}';\n`],
  ]);
// every import form of the packages, and their subpaths
const EVERY_IMPORT = [
  ...values(...I18N_PACKAGES, ...I18N_SUBPATHS),
  ...types(...I18N_PACKAGES),
  ...reExports(...I18N_PACKAGES),
];
const jestModuleCalls = (...specifiers) =>
  specifiers.flatMap((s) => [jestCall('mock', s), jestCall('requireActual', s)]);

// one file per layer outside src/core/i18n, for every import form
const LAYER_FILES = [
  EXISTING.layout,
  PROBES.features,
  PROBES.ui,
  PROBES.platform,
  PROBES.core,
  PROBES.coreTest,
];
// every other file outside src/core/i18n: routes, features, ui, platform, core (the implementation
// folders and test/core included), production files and tests
const OTHER_FILES = [
  EXISTING.index,
  PROBES.layoutTs,
  PROBES.nestedRoute,
  PROBES.featuresComponent,
  PROBES.featuresTest,
  PROBES.featuresFixture,
  PROBES.uiComponent,
  PROBES.uiTest,
  PROBES.platformTest,
  PROBES.hooks,
  PROBES.domain,
  PROBES.catalogInterface,
  PROBES.jikan,
  PROBES.supabase,
  PROBES.local,
  PROBES.hooksTest,
  PROBES.coreTestSource,
];
const TESTS_OUTSIDE_I18N = [
  PROBES.featuresTest,
  PROBES.featuresTestComponent,
  PROBES.uiTest,
  PROBES.uiTestComponent,
  PROBES.platformTest,
  PROBES.hooksTest,
  PROBES.coreTest,
];
const I18N_FILES = [PROBES.i18n, PROBES.i18nTest];

// the files that may import src/core at run time; src/platform imports it as types only
const CORE_CONSUMERS = [
  EXISTING.layout,
  EXISTING.index,
  PROBES.nestedRoute,
  PROBES.features,
  PROBES.featuresComponent,
  PROBES.featuresTest,
  PROBES.core,
  PROBES.hooks,
  PROBES.hooksTest,
  PROBES.coreTest,
];

export const REJECTED = {
  'i18n libraries only in src/core/i18n': [
    ...rejected(LAYER_FILES, IMPORTS, MESSAGES.i18n, EVERY_IMPORT),
    ...rejected(OTHER_FILES, IMPORTS, MESSAGES.i18n, values(...I18N_PACKAGES)),
    ...rejected(
      [...LAYER_FILES, ...OTHER_FILES],
      SYNTAX,
      MESSAGES.i18n,
      dynamics(...I18N_PACKAGES),
    ),
    // a jest module call loads or mocks the module like an import
    ...rejected(TESTS_OUTSIDE_I18N, SYNTAX, MESSAGES.i18n, jestModuleCalls(...I18N_PACKAGES)),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'i18n libraries only in src/core/i18n': [
    ...allowed(I18N_FILES, [...EVERY_IMPORT, ...dynamics(...I18N_PACKAGES)]),
    ...allowed(PROBES.i18nTest, jestModuleCalls(...I18N_PACKAGES)),
    // the public api of src/core/i18n, wherever src/core is allowed
    ...allowed(CORE_CONSUMERS, [...values(PUBLIC_API), ...types(PUBLIC_API)]),
    ...allowed([PROBES.platform, PROBES.platformTest], types(PUBLIC_API)),
    ...allowed([PROBES.featuresTest, PROBES.hooksTest], jestModuleCalls(PUBLIC_API)),
  ],
};
