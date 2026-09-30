// case tables for layers.test.mjs on the i18n libraries: i18next and react-i18next are imported only
// in src/core/i18n, its co-located tests included; every other file, whatever its layer, translates
// through @core/i18n (docs/adr/0011-internationalization-i18next.md)

import { PROBES } from './layers-harness.mjs';
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

// which files ban the packages is decided per config entry, and every import form goes through the
// same patterns: every form on a feature, src/platform (the layer with type-only patterns) and
// src/core; one import and one import() on a file of each other entry outside src/core/i18n. the
// cases of a file run one after the other: switching files costs more than linting one
const FORM_FILES = [PROBES.features, PROBES.platform, PROBES.core];
const SAMPLE_FILES = [
  PROBES.nestedRoute,
  PROBES.featuresTest,
  PROBES.ui,
  PROBES.coreTest,
  PROBES.jikan,
  PROBES.supabase,
];
// a jest test of each entry outside src/core/i18n
const TESTS_OUTSIDE_I18N = [
  PROBES.featuresTest,
  PROBES.uiTest,
  PROBES.platformTest,
  PROBES.coreTest,
];
// src/core files, which import src/core at run time; the i18n barrel cases cover the screen layers
// and src/platform
const CORE_CONSUMERS = [PROBES.core, PROBES.coreTest];

export const REJECTED = {
  'i18n libraries only in src/core/i18n': [
    ...FORM_FILES.flatMap((file) => [
      ...rejected(file, IMPORTS, MESSAGES.i18n, EVERY_IMPORT),
      ...rejected(file, SYNTAX, MESSAGES.i18n, dynamics(...I18N_PACKAGES)),
    ]),
    ...SAMPLE_FILES.flatMap((file) => [
      ...rejected(file, IMPORTS, MESSAGES.i18n, values('i18next')),
      ...rejected(file, SYNTAX, MESSAGES.i18n, dynamics('react-i18next')),
    ]),
    // a jest module call loads or mocks the module like an import
    ...rejected(TESTS_OUTSIDE_I18N, SYNTAX, MESSAGES.i18n, [
      jestCall('mock', 'i18next'),
      jestCall('requireActual', 'react-i18next'),
    ]),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'i18n libraries only in src/core/i18n': [
    ...allowed(PROBES.i18n, [...EVERY_IMPORT, ...dynamics(...I18N_PACKAGES)]),
    ...allowed(PROBES.i18nTest, [
      ...values(...I18N_PACKAGES),
      ...jestModuleCalls(...I18N_PACKAGES),
    ]),
    // the public api of src/core/i18n in src/core
    ...allowed(CORE_CONSUMERS, [...values(PUBLIC_API), ...types(PUBLIC_API)]),
    ...allowed(PROBES.hooksTest, jestModuleCalls(PUBLIC_API)),
  ],
};
