// case tables for layers.test.mjs on the public api of src/core/i18n: routes (app/), features
// (src/features/) and src/platform import it only through its barrel, @core/i18n/index, types
// included, so createI18n, resources and the catalogs stay internal; src/platform imports the
// barrel as types only. src/core/i18n itself, and the rest of src/core, are not restricted
// (docs/adr/0011-internationalization-i18next.md)

import { EXISTING, PROBES } from './layers-harness.mjs';
import {
  IMPORTS,
  MESSAGES,
  SYNTAX,
  allowed,
  dynamics,
  rejected,
  relativeFrom,
  types,
  values,
} from './layers-cases.mjs';
import { jestCall } from './layers-test-code-cases.mjs';

const BARREL = '@core/i18n/index';
const BARREL_PATH = 'src/core/i18n/index';

const DEEP_ALIASES = [
  '@core/i18n/create-i18n',
  '@core/i18n/resources',
  '@core/i18n/en.json',
  '@core/i18n/index.ts',
  '@core/i18n',
  // a "." segment is not caught by the canonical path rule: the barrel rule sees it
  '@core/i18n/./create-i18n',
];
const DEEP_RELATIVE_TARGETS = ['src/core/i18n/create-i18n', 'src/core/i18n/i18n-context'];

// probes are [label, code] pairs
const named = (name, specifier) => [
  `import { ${name} } from '${specifier}'`,
  `import { ${name} } from '${specifier}';\nexport const value = ${name};\n`,
];
const inlineTypes = (...specifiers) =>
  specifiers.map((s) => [
    `import { type Probe } from '${s}'`,
    `import { type Probe } from '${s}';\nexport type Value = Probe;\n`,
  ]);
const reExports = (...specifiers) =>
  specifiers.flatMap((s) => [
    [`export { probe } from '${s}'`, `export { probe } from '${s}';\n`],
    [`export type { Probe } from '${s}'`, `export type { Probe } from '${s}';\n`],
    [`export * from '${s}'`, `export * from '${s}';\n`],
  ]);

// every static import form of the deep aliases, and relative paths into src/core/i18n, the barrel
// included: the only spelling of the public api is @core/i18n/index
const deepStaticImports = (file) => [
  named('createI18n', '@core/i18n/create-i18n'),
  named('I18nContext', '@core/i18n/i18n-context'),
  ...values(...DEEP_ALIASES),
  ...types(...DEEP_ALIASES),
  ...inlineTypes('@core/i18n/locale-adapter'),
  ...reExports('@core/i18n/create-i18n'),
  ...values(
    ...[...DEEP_RELATIVE_TARGETS, BARREL_PATH, 'src/core/i18n'].map((target) =>
      relativeFrom(file, target),
    ),
  ),
  ...types(relativeFrom(file, 'src/core/i18n/locale-adapter')),
];
const deepDynamicImports = (file) =>
  dynamics('@core/i18n/create-i18n', '@core/i18n', relativeFrom(file, 'src/core/i18n/resources'));

// the ban is decided per config entry and every form goes through the same patterns: every form on
// a feature and on src/platform (the layer with type-only patterns), and a sample, the relative
// paths of each folder depth included, on a file of each other entry and glob. the cases of a file
// run one after the other: switching files costs more than linting one
const FORM_FILES = [PROBES.features, PROBES.platform];
const SAMPLE_FILES = [
  PROBES.notFound,
  PROBES.nestedRoute,
  PROBES.featuresTestComponent,
  PROBES.featuresFixture,
  PROBES.platformTest,
];
const sampleImports = (file) => [
  named('I18nContext', '@core/i18n/i18n-context'),
  ...types('@core/i18n/locale-adapter'),
  ...values(relativeFrom(file, 'src/core/i18n/create-i18n'), relativeFrom(file, BARREL_PATH)),
];
// jest tests of the restricted layers
const JEST_TESTS = [PROBES.featuresTest, PROBES.platformTest];

export const REJECTED = {
  'src/core/i18n through its barrel only': [
    ...FORM_FILES.flatMap((file) => [
      ...rejected(file, IMPORTS, MESSAGES.i18nBarrel, deepStaticImports(file)),
      ...rejected(file, SYNTAX, MESSAGES.i18nBarrel, deepDynamicImports(file)),
    ]),
    // src/platform still imports the barrel as types only
    ...rejected(PROBES.platform, IMPORTS, MESSAGES.typeOnly, [
      ...values(BARREL),
      reExports(BARREL)[0],
    ]),
    ...rejected(PROBES.platform, SYNTAX, MESSAGES.typeOnly, dynamics(BARREL)),
    ...SAMPLE_FILES.flatMap((file) => [
      ...rejected(file, IMPORTS, MESSAGES.i18nBarrel, sampleImports(file)),
      ...rejected(file, SYNTAX, MESSAGES.i18nBarrel, dynamics('@core/i18n/create-i18n')),
    ]),
    // an existing route, linted with its project
    ...rejected(EXISTING.layout, IMPORTS, MESSAGES.i18nBarrel, [
      named('I18nContext', '@core/i18n/i18n-context'),
    ]),
    // a jest module call loads or mocks the module like an import
    ...rejected(JEST_TESTS, SYNTAX, MESSAGES.i18nBarrel, [
      jestCall('mock', '@core/i18n/create-i18n'),
      jestCall('requireActual', '@core/i18n/resources'),
    ]),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'src/core/i18n through its barrel only': [
    ...allowed(PROBES.features, [
      ...values(BARREL),
      ...types(BARREL),
      ...inlineTypes(BARREL),
      ...reExports(BARREL),
      ...dynamics(BARREL),
    ]),
    ...allowed(
      [PROBES.notFound, PROBES.featuresTestComponent],
      [...values(BARREL), ...types(BARREL)],
    ),
    ...allowed(EXISTING.layout, values(BARREL)),
    // src/platform imports the barrel as types only
    ...allowed(PROBES.platform, [...types(BARREL), ...inlineTypes(BARREL), reExports(BARREL)[1]]),
    ...allowed(PROBES.platformTest, types(BARREL)),
    ...allowed(JEST_TESTS, [jestCall('mock', BARREL)]),
    // a folder whose name only starts with i18n is another module
    ...allowed(PROBES.features, values('@core/i18n-extra/x')),
  ],
  // documents current behavior, not a rule: src/core/i18n imports its own internals, and the rest
  // of src/core may too (restricting it later must update these cases on purpose)
  'src/core/i18n internals from src/core (currently allowed)': [
    ...allowed(PROBES.i18n, [
      ...values(...DEEP_RELATIVE_TARGETS.map((target) => relativeFrom(PROBES.i18n, target))),
      ...values('@core/i18n/create-i18n'),
      ...types('@core/i18n/locale-adapter'),
    ]),
    ...allowed(PROBES.i18nTest, values('@core/i18n/resources')),
    ...allowed(PROBES.hooks, [
      ...values('@core/i18n/create-i18n'),
      ...types('@core/i18n/locale-adapter'),
    ]),
    ...allowed([PROBES.core, PROBES.coreTest], values('@core/i18n/resources')),
  ],
};
