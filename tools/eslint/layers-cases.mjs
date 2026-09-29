// case tables for layers.test.mjs, and the helpers of the other layers-*-cases.mjs tables: every
// rejected case names the exact rule and a fragment of its message, so an unrelated error cannot
// satisfy it

import path from 'node:path';

import { EXISTING, PROBES } from './layers-harness.mjs';

export const PATHS = 'import-x/no-restricted-paths';
export const IMPORTS = '@typescript-eslint/no-restricted-imports';
export const SYNTAX = 'no-restricted-syntax';

export const MESSAGES = {
  core: 'src/core is platform-agnostic and imports no other layer',
  coreInterfaces: 'src/core uses repository and catalog provider interfaces',
  ui: 'src/ui depends only on itself',
  platform: 'src/platform depends only on src/core',
  app: 'app/ is the composition root: nothing imports it',
  features: 'src/features uses src/core hooks, never repository or catalog provider',
  root: 'only app/_layout.tsx (the composition root) wires',
  reactNative: 'src/core stays platform-agnostic: no React Native',
  expo: 'src/core stays platform-agnostic: no Expo module',
  nativewind: 'NativeWind is used only inside src/ui',
  supabase: 'the Supabase client is imported only in src/core/repositories/supabase',
  network: 'have no direct network access',
  expoInternals: 'deep imports of Expo internals',
  canonical: 'import paths are written canonically',
  typeOnly: 'src/platform imports src/core with "import type" only',
  literal: 'import() takes a string literal',
  jikan: 'the catalog provider is reached only through its adapter',
  outsideLayers: 'every file under src/ belongs to one of the four layers',
  testInfrastructure: 'production code never imports the test infrastructure in test/',
  className: 'className is used only inside src/ui',
};

export const APP_INDEX_FROM_SRC_LAYER = '../../app/index';

const IMPLEMENTATIONS = [
  '@core/catalog/jikan/jikan-catalog-provider',
  '@core/repositories/supabase/supabase-library-repository',
  '@core/repositories/local/local-library-repository',
];

export const valueImport = (specifier) =>
  `import { probe } from '${specifier}';\nexport const value = probe;\n`;
const typeImport = (specifier) =>
  `import type { Probe } from '${specifier}';\nexport type Value = Probe;\n`;
const dynamicImport = (specifier) => `export const load = () => import('${specifier}');\n`;

// probes are [label, code] pairs
export const values = (...specifiers) => specifiers.map((s) => [`import '${s}'`, valueImport(s)]);
const types = (...specifiers) => specifiers.map((s) => [`import type '${s}'`, typeImport(s)]);
export const dynamics = (...specifiers) =>
  specifiers.map((s) => [`import('${s}')`, dynamicImport(s)]);

// a module with nothing to report: only its path can break a rule
const PLAIN_MODULE = ['plain module', 'export const value = 1;\n'];

// relative specifier from a probe to a root-relative module, e.g. "../repositories/local/x"
export const relativeFrom = (file, target) => {
  const specifier = path.posix.relative(path.posix.dirname(file), target);
  return specifier.startsWith('.') ? specifier : `./${specifier}`;
};

// every implementation in the four import forms: alias, relative, import type, import()
const implementationImports = (file) => [
  ...values(...IMPLEMENTATIONS),
  ...values(...IMPLEMENTATIONS.map((s) => relativeFrom(file, s.replace(/^@core\//, 'src/core/')))),
  ...types(...IMPLEMENTATIONS),
  ...dynamics(...IMPLEMENTATIONS),
];

export const rejected = (files, ruleId, fragment, probes) =>
  [files].flat().flatMap((file) =>
    probes.map(([label, code]) => ({
      name: `${label} in ${file}`,
      file,
      code,
      ruleId,
      fragment,
    })),
  );

export const allowed = (files, probes) =>
  [files]
    .flat()
    .flatMap((file) =>
      probes.map(([label, code]) => ({ name: `${label} in ${file}`, file, code })),
    );

const APP_ROUTES = [
  PROBES.layoutTs,
  PROBES.nestedLayout,
  EXISTING.index,
  PROBES.nestedRoute,
  PROBES.notFound,
];
const CORE_FILES = [PROBES.core, PROBES.coreTest, PROBES.hooks];
// every src/core and test/core file outside the implementation folders
const INTERFACE_SIDE_FILES = [
  PROBES.core,
  PROBES.hooks,
  PROBES.domain,
  PROBES.repositoryInterface,
  PROBES.catalogInterface,
  PROBES.coreTest,
  PROBES.coreTestSource,
];
const INTERFACES = ['@core/repositories/library-repository', '@core/catalog/catalog-provider'];

export const REJECTED = {
  zones: [
    ...rejected(PROBES.core, PATHS, MESSAGES.core, [
      ...values('@platform/storage', '@features/search/x', '@ui/components/Button'),
      ...values(APP_INDEX_FROM_SRC_LAYER),
    ]),
    ...rejected(PROBES.ui, PATHS, MESSAGES.ui, [
      ...values('@core/domain/progress', '@features/search/x', '@platform/storage'),
      ...values(APP_INDEX_FROM_SRC_LAYER),
    ]),
    ...rejected(PROBES.platform, PATHS, MESSAGES.platform, [
      ...values('@features/search/x', '@ui/components/Button', APP_INDEX_FROM_SRC_LAYER),
    ]),
    ...rejected(PROBES.features, PATHS, MESSAGES.app, values(APP_INDEX_FROM_SRC_LAYER)),
    ...rejected(PROBES.features, PATHS, MESSAGES.features, values(...IMPLEMENTATIONS)),
    ...INTERFACE_SIDE_FILES.flatMap((file) =>
      rejected(file, PATHS, MESSAGES.coreInterfaces, implementationImports(file)),
    ),
    ...rejected(APP_ROUTES, PATHS, MESSAGES.root, values(...IMPLEMENTATIONS)),
  ],

  'package bans': [
    ...rejected(CORE_FILES, IMPORTS, MESSAGES.reactNative, [
      ...values('react-native', 'react-native-foo', '@react-native/x'),
      ...values('@testing-library/react-native'),
    ]),
    ...rejected(CORE_FILES, IMPORTS, MESSAGES.expo, values('expo', 'expo-constants', '@expo/x')),
    ...rejected(CORE_FILES, IMPORTS, MESSAGES.nativewind, values('nativewind')),
    ...rejected(PROBES.core, SYNTAX, MESSAGES.reactNative, dynamics('react-native')),
    ...rejected(PROBES.jikan, IMPORTS, MESSAGES.reactNative, values('react-native')),
    ...rejected(PROBES.supabase, IMPORTS, MESSAGES.expo, values('expo-constants')),
    ...rejected(
      [PROBES.features, EXISTING.index, PROBES.platform],
      IMPORTS,
      MESSAGES.nativewind,
      values('nativewind'),
    ),
    ...rejected(
      [...CORE_FILES, PROBES.jikan, PROBES.ui, PROBES.platform, PROBES.features, EXISTING.index],
      IMPORTS,
      MESSAGES.supabase,
      values('@supabase/supabase-js'),
    ),
    ...rejected(PROBES.features, SYNTAX, MESSAGES.supabase, dynamics('@supabase/supabase-js')),
  ],

  'src outside the four layers': rejected(
    [PROBES.srcRoot, PROBES.srcOther],
    SYNTAX,
    MESSAGES.outsideLayers,
    [PLAIN_MODULE],
  ),

  'type-only core imports from platform': [
    ...rejected(PROBES.platform, IMPORTS, MESSAGES.typeOnly, [
      ...values('@core/domain/x', '../core/domain/x', '@core'),
      ['re-export', "export { probe } from '@core/domain/x';\n"],
    ]),
    ...rejected(PROBES.platform, SYNTAX, MESSAGES.typeOnly, dynamics('@core/domain/x')),
  ],

  'canonical paths': [
    ...rejected(PROBES.core, IMPORTS, MESSAGES.canonical, values('@core/../platform/x')),
    ...rejected(PROBES.features, IMPORTS, MESSAGES.canonical, [
      ...values('@core/../features/x', '../../node_modules/@supabase/supabase-js'),
      ...values('node_modules/expo/fetch'),
    ]),
  ],

  'literal import()': [
    ...rejected([PROBES.features, PROBES.core, PROBES.platform], SYNTAX, MESSAGES.literal, [
      ['import(variable)', "const name = '@core/x';\nexport const load = () => import(name);\n"],
    ]),
    ...rejected(PROBES.features, SYNTAX, MESSAGES.literal, [
      ['import(`template`)', 'export const load = () => import(`@core/x`);\n'],
    ]),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  zones: [
    ...allowed(PROBES.hooks, [
      ...types(...INTERFACES),
      ...values('@core/repositories/library-repository', '../catalog/catalog-provider'),
    ]),
    ...allowed(PROBES.domain, [...types(...INTERFACES), ...values(...INTERFACES)]),
    ...allowed([PROBES.repositoryInterface, PROBES.catalogInterface], values('@core/domain/x')),
    // an implementation folder imports its own files and the interfaces
    ...allowed(PROBES.supabase, values('./y', '@core/repositories/supabase/y')),
    ...allowed(PROBES.jikan, values('./y', '@core/catalog/jikan/y')),
    ...allowed(PROBES.local, values('./y', '@core/repositories/local/y')),
    ...allowed(
      [PROBES.supabase, PROBES.local],
      [
        ...values('@core/repositories/library-repository', '../library-repository'),
        ...types('@core/repositories/library-repository'),
      ],
    ),
    ...allowed(PROBES.jikan, [
      ...values('../catalog-provider'),
      ...types('@core/catalog/catalog-provider'),
    ]),
    ...allowed(PROBES.features, values('@core/hooks/use-library')),
    ...allowed(EXISTING.layout, values(...IMPLEMENTATIONS)),
  ],
  // documents current behavior, not a rule: the owner decided not to restrict imports between
  // implementation folders in F-03. restricting them later must update these cases on purpose
  'zones: cross-implementation imports (currently allowed)': [
    ...allowed(PROBES.supabase, values('../local/y', '@core/repositories/local/y')),
    ...allowed(PROBES.local, values('../supabase/y', '@core/repositories/supabase/y')),
    ...allowed(
      PROBES.jikan,
      values('../../repositories/supabase/y', '@core/repositories/supabase/y'),
    ),
  ],
  'package bans': [
    ...allowed(PROBES.ui, values('nativewind')),
    ...allowed(PROBES.supabase, values('@supabase/supabase-js')),
  ],
  'src outside the four layers': allowed(
    [
      PROBES.core,
      PROBES.hooks,
      PROBES.jikan,
      PROBES.supabase,
      PROBES.features,
      PROBES.featuresTest,
      PROBES.ui,
      PROBES.uiComponent,
      PROBES.platform,
    ],
    [PLAIN_MODULE],
  ),
  'type-only core imports from platform': allowed(PROBES.platform, [
    ...types('@core/domain/x', '../core/domain/x', '@core/repositories/library-repository'),
    ...values('@core/errors/app-error', '../core/errors/app-error', '@core/errors'),
  ]),
  'literal import()': allowed(PROBES.features, dynamics('@core/hooks/use-library')),
};
