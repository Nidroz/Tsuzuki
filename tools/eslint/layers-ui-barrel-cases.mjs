// case tables for layers.test.mjs on the public api of the design system: routes (app/) and
// features (src/features/) import src/ui only through its barrel, @ui/index, types included, so the
// public surface stays single; src/ui itself imports its own internals freely (CONTRIBUTING.md
// section 4)

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

const BARREL = '@ui/index';
const BARREL_PATH = 'src/ui/index';

// internals, and the theme barrel, which is not a public entry point either
const DEEP_ALIASES = [
  '@ui/theme/theme-context',
  '@ui/components/Box',
  '@ui/components/layout/layout-classes',
  '@ui/theme',
  '@ui/theme/index',
  // a "." segment is reported by the canonical path rule, and the barrel rule sees it too
  '@ui/./components/Box',
];
const CANONICAL_DEEP_ALIASES = DEEP_ALIASES.filter((specifier) => !specifier.includes('/./'));
const DEEP_RELATIVE_TARGETS = ['src/ui/components/Box', 'src/ui/theme/theme-context'];

// probes are [label, code] pairs
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

// every static import form of the deep aliases, and relative paths into src/ui, the barrel included:
// the only spelling of the public api is @ui/index
const deepStaticImports = (file) => [
  ...values(...DEEP_ALIASES),
  ...types(...DEEP_ALIASES),
  ...inlineTypes('@ui/components/Box'),
  ...reExports('@ui/components/Box'),
  ...values(
    ...[...DEEP_RELATIVE_TARGETS, BARREL_PATH, 'src/ui'].map((target) =>
      relativeFrom(file, target),
    ),
  ),
  ...types(relativeFrom(file, 'src/ui/components/Box')),
];
const deepDynamicImports = (file) =>
  dynamics('@ui/components/Box', '@ui/theme', relativeFrom(file, 'src/ui/components/Box'));

// one module, one component and one test in each screen layer, nested routes included
const SCREEN_FILES = [
  PROBES.layoutTs,
  PROBES.nestedRoute,
  PROBES.features,
  PROBES.featuresComponent,
  PROBES.featuresTestComponent,
];
// the existing routes, the composition root included
const EXISTING_ROUTES = [EXISTING.layout, EXISTING.index];
const SCREEN_TESTS = [PROBES.featuresTest, PROBES.featuresTestComponent];
// src/ui files, tests included
const UI_FILES = [PROBES.ui, PROBES.uiComponent, PROBES.uiTest, PROBES.uiTestComponent];

export const REJECTED = {
  'src/ui through its barrel only': [
    ...SCREEN_FILES.flatMap((file) =>
      rejected(file, IMPORTS, MESSAGES.uiBarrel, deepStaticImports(file)),
    ),
    ...SCREEN_FILES.flatMap((file) =>
      rejected(file, SYNTAX, MESSAGES.uiBarrel, deepDynamicImports(file)),
    ),
    ...rejected(EXISTING_ROUTES, IMPORTS, MESSAGES.uiBarrel, [
      ...values('@ui/components/Box', '@ui/theme/theme-context'),
      ...types('@ui/components/Box'),
    ]),
    // a jest module call loads or mocks the module like an import
    ...rejected(SCREEN_TESTS, SYNTAX, MESSAGES.uiBarrel, [
      jestCall('mock', '@ui/components/Box'),
      jestCall('requireActual', '@ui/theme/theme-context'),
    ]),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'src/ui through its barrel only': [
    ...allowed(
      [...SCREEN_FILES, ...EXISTING_ROUTES],
      [
        ...values(BARREL),
        ...types(BARREL),
        ...inlineTypes(BARREL),
        ...reExports(BARREL),
        ...dynamics(BARREL),
      ],
    ),
    ...allowed(SCREEN_TESTS, [jestCall('mock', BARREL), jestCall('requireActual', BARREL)]),
    // src/ui imports its own internals, relative or through the alias, written canonically (a "."
    // segment is rejected everywhere by the canonical path rule)
    ...UI_FILES.flatMap((file) =>
      allowed(file, [
        ...values(...DEEP_RELATIVE_TARGETS.map((target) => relativeFrom(file, target))),
        ...types(relativeFrom(file, 'src/ui/components/Box')),
        ...values(...CANONICAL_DEEP_ALIASES),
        ...types(...CANONICAL_DEEP_ALIASES),
        ...dynamics('@ui/components/Box', relativeFrom(file, 'src/ui/theme/theme-context')),
      ]),
    ),
  ],
};
