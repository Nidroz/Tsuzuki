// layer rule tables for eslint.config.mjs: banned imports and jest module calls per layer,
// import-x/no-restricted-paths zones, network guards and the className guards (CONTRIBUTING.md
// section 4)

const LAYERS_RULE = 'CONTRIBUTING.md section 4';

export const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
export const NETWORK_MESSAGE = `routes, features and UI components have no direct network access: it goes through src/core and src/platform (${LAYERS_RULE}).`;

// banned package groups; F-05/F-06 extend this table
const BANNED = {
  reactNative: {
    regexes: [
      '^react-native($|/)',
      '^react-native-',
      '^@react-native(-[^/]+)?/',
      '^@[^/]+/react-native',
    ],
    message: `src/core stays platform-agnostic: no React Native (${LAYERS_RULE}).`,
  },
  expo: {
    regexes: ['^expo($|/)', '^expo-', '^@expo/'],
    message: `src/core stays platform-agnostic: no Expo module (${LAYERS_RULE}).`,
  },
  nativewind: {
    regexes: ['^nativewind($|/)', '^react-native-css-interop'],
    message: `NativeWind is used only inside src/ui (${LAYERS_RULE}).`,
  },
  supabase: {
    regexes: ['^@supabase/'],
    message: `the Supabase client is imported only in src/core/repositories/supabase (${LAYERS_RULE}).`,
  },
  network: { regexes: ['^expo/fetch(?:$|[./])'], message: NETWORK_MESSAGE },
  // expo/src and expo/build reach modules such as fetch without their public specifier
  expoInternals: {
    regexes: ['^expo/(?:src|build)(?:$|/)'],
    message: `deep imports of Expo internals bypass the rules on routes, features and UI components: use public entry points (${LAYERS_RULE}).`,
  },
};

// the rules above read the specifier text: "@core/../x" or a node_modules path would slip past them
const CANONICAL_PATHS = {
  regexes: ['(?:^|/)node_modules(?:/|$)', '(?:^|/)(?!\\.\\.(?:/|$))[^/]+/\\.\\.(?:/|$)'],
  message: `import paths are written canonically, with no ".." after a segment and no node_modules path, so layer rules can check them (${LAYERS_RULE}).`,
};

// platform may import core only as types, except typed errors (owner decision)
const PLATFORM_CORE_TYPE_ONLY = {
  regexes: [
    '^@core(?:$|/(?!errors(?:/|$)))',
    '^(?:\\.{1,2}/)+(?:src/)?core(?:$|/(?!errors(?:/|$)))',
  ],
  message: `src/platform imports src/core with "import type" only, except @core/errors (${LAYERS_RULE}).`,
};

// a non-literal import() source would bypass every import rule; metro bundles only literal sources
const LITERAL_IMPORT_GUARD = {
  selector: "ImportExpression:not([source.type='Literal'])",
  message: `import() takes a string literal so layer rules can check it (${LAYERS_RULE}).`,
};

const JIKAN_MESSAGE = `the catalog provider is reached only through its adapter in src/core/catalog/jikan (${LAYERS_RULE}).`;
const JIKAN_GUARDS = [
  { selector: 'Literal[value=/jikan\\.moe/i]', message: JIKAN_MESSAGE },
  { selector: 'TemplateElement[value.raw=/jikan\\.moe/i]', message: JIKAN_MESSAGE },
];

// className and its variants (contentContainerClassName, ...) as JSX props or object keys (spread
// props, createElement props, destructuring); the word as a string value stays allowed
const CLASS_NAME_MESSAGE = `className is used only inside src/ui, the only layer that uses NativeWind (${LAYERS_RULE}).`;
const CLASS_NAME_PATTERN = '/^(?:[a-z][A-Za-z]*C|c)lassName$/';
const CLASS_NAME_GUARDS = [
  { selector: `JSXAttribute[name.name=${CLASS_NAME_PATTERN}]`, message: CLASS_NAME_MESSAGE },
  {
    selector: `Property:matches([computed=false][key.name=${CLASS_NAME_PATTERN}], [key.value=${CLASS_NAME_PATTERN}])`,
    message: CLASS_NAME_MESSAGE,
  },
];

// every file's no-restricted-syntax guards outside src/ui and tools/; a block that sets its own
// options must re-include them
export const BASE_SYNTAX_GUARDS = [...JIKAN_GUARDS, ...CLASS_NAME_GUARDS];

// tools/ holds the lint rules and their case tables, which name className as data: no className
// guard there, NativeWind never runs in it
export const TOOLING_FILES = ['tools/**'];
export const TOOLING_SYNTAX_GUARDS = [...JIKAN_GUARDS];

// every file under src/ belongs to a layer, so each file gets the rules of exactly one layer
const SRC_LAYER_FOLDERS = ['src/core', 'src/features', 'src/ui', 'src/platform'];
export const SRC_OUTSIDE_LAYERS = {
  files: ['src/**'],
  ignores: SRC_LAYER_FOLDERS.map((folder) => `${folder}/**`),
  rules: {
    'no-restricted-syntax': [
      'error',
      ...BASE_SYNTAX_GUARDS,
      {
        selector: 'Program',
        message: `every file under src/ belongs to one of the four layers: ${SRC_LAYER_FOLDERS.join(', ')} (${LAYERS_RULE}).`,
      },
    ],
  },
};

// esquery regex literals cannot contain "/", even escaped
const toSelectorRegex = (regex) => `/${regex.replaceAll('/', '\\x2F')}/i`;

// every jest function that loads or mocks a module by its specifier: its first argument follows the
// package bans of the layer, like an import
const JEST_MODULE_METHODS = [
  'mock',
  'doMock',
  'requireActual',
  'requireMock',
  'unstable_mockModule',
  'createMockFromModule',
];
const JEST_MODULE_CALL = `CallExpression[callee.type='MemberExpression'][callee.computed=false][callee.object.name='jest'][callee.property.name=/^(?:${JEST_MODULE_METHODS.join('|')})$/]`;

// any other first argument (template literal, identifier, concatenation, spread) would hide the
// specifier from the package bans below, like a non-literal import() source; a string value only
// exists on a string literal
const JEST_LITERAL_GUARD = {
  selector: `${JEST_MODULE_CALL}:not([arguments.0.type='Literal'][arguments.0.value=/^/])`,
  message: `jest module calls take a string literal so layer rules can check them: ${JEST_MODULE_METHODS.join(', ')} (${LAYERS_RULE}).`,
};

// flat config replaces (never merges) rule options for overlapping files, so each layer gets one
// complete option set for no-restricted-imports and no-restricted-syntax
export const layerRules = ({
  banned: layerBanned,
  typeOnly,
  allowJikan = false,
  allowClassName = false,
}) => {
  const banned = [CANONICAL_PATHS, ...layerBanned];
  return {
    'no-restricted-imports': 'off',
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        patterns: [
          ...banned.flatMap(({ regexes, message }) => regexes.map((regex) => ({ regex, message }))),
          ...(typeOnly?.regexes ?? []).map((regex) => ({
            regex,
            message: typeOnly.message,
            allowTypeImports: true,
          })),
        ],
      },
    ],
    // static imports are covered above; these guards cover import() calls, always runtime imports,
    // and the jest module calls (package bans only, on a string literal first argument)
    'no-restricted-syntax': [
      'error',
      LITERAL_IMPORT_GUARD,
      JEST_LITERAL_GUARD,
      ...[...banned, ...(typeOnly ? [typeOnly] : [])].flatMap(({ regexes, message }) =>
        regexes.map((regex) => ({
          selector: `ImportExpression[source.value=${toSelectorRegex(regex)}]`,
          message,
        })),
      ),
      ...layerBanned.flatMap(({ regexes, message }) =>
        regexes.map((regex) => ({
          selector: `${JEST_MODULE_CALL}[arguments.0.value=${toSelectorRegex(regex)}]`,
          message,
        })),
      ),
      ...(allowJikan ? [] : JIKAN_GUARDS),
      ...(allowClassName ? [] : CLASS_NAME_GUARDS),
    ],
  };
};

const { reactNative, expo, nativewind, supabase, network, expoInternals } = BANNED;
export const LAYERS = [
  {
    files: ['src/core/**', 'test/core/**'],
    ignores: ['src/core/repositories/supabase/**', 'src/core/catalog/jikan/**'],
    banned: [reactNative, expo, nativewind, supabase],
  },
  {
    files: ['src/core/catalog/jikan/**'],
    banned: [reactNative, expo, nativewind, supabase],
    allowJikan: true,
  },
  { files: ['src/core/repositories/supabase/**'], banned: [reactNative, expo, nativewind] },
  { files: ['src/ui/**'], banned: [supabase, network, expoInternals], allowClassName: true },
  {
    files: ['src/platform/**'],
    banned: [nativewind, supabase],
    typeOnly: PLATFORM_CORE_TYPE_ONLY,
  },
  { files: ['src/features/**'], banned: [nativewind, supabase, network, expoInternals] },
  { files: ['app/**'], banned: [nativewind, supabase, network, expoInternals] },
];

const layerZone = (target, from, message) => ({
  target,
  from,
  message: `${message} (${LAYERS_RULE}).`,
});

// every catalog provider adapter and repository implementation folder: a new provider next to
// jikan/ must be added here
const IMPLEMENTATION_FOLDERS = [
  './src/core/catalog/jikan',
  './src/core/repositories/supabase',
  './src/core/repositories/local',
];

const CORE_ROOT = './src/core';

// globs for every file under root except the excluded folders (leaves under root): at each level
// on the way down to them, the files of that folder plus every sibling folder. targets are
// minimatch globs on absolute paths; on windows the resolved target puts a backslash before each
// segment, which escapes a leading "!(": each pattern keeps another glob character to stay a glob
const targetsExcept = (root, excluded) => {
  const children = new Map();
  for (const folder of excluded) {
    if (!folder.startsWith(`${root}/`)) {
      throw new Error(`${folder} is not under ${root}`);
    }
    const segments = folder.slice(`${root}/`.length).split('/');
    segments.forEach((segment, index) => {
      const parent = [root, ...segments.slice(0, index)].join('/');
      children.set(parent, new Set([...(children.get(parent) ?? []), segment]));
    });
  }
  return [...children].flatMap(([folder, names]) => [
    `${folder}/*.*`,
    `${folder}/!(${[...names].join('|')})/**`,
  ]);
};

// zones for import-x/no-restricted-paths, relative to the config's basePath (the repo root)
export const LAYER_ZONES = [
  layerZone(
    './src/core',
    ['./src/platform', './src/features', './src/ui', './app'],
    'src/core is platform-agnostic and imports no other layer',
  ),
  // the implementation folders themselves are left out of the targets
  layerZone(
    [...targetsExcept(CORE_ROOT, IMPLEMENTATION_FOLDERS), './test/core/**'],
    IMPLEMENTATION_FOLDERS,
    'src/core uses repository and catalog provider interfaces; only the implementation folders themselves (and app/_layout.tsx) touch implementations',
  ),
  layerZone(
    './src/ui',
    ['./src/core', './src/features', './src/platform', './app'],
    'src/ui depends only on itself (theme and components)',
  ),
  layerZone(
    './src/platform',
    ['./src/features', './src/ui', './app'],
    'src/platform depends only on src/core',
  ),
  layerZone('./src/features', ['./app'], 'app/ is the composition root: nothing imports it'),
  layerZone(
    './src/features',
    IMPLEMENTATION_FOLDERS,
    'src/features uses src/core hooks, never repository or catalog provider implementations',
  ),
  // targets are minimatch globs on absolute paths: every nested file (nested layouts included),
  // every root file not named _layout.*, and every _layout.* variant except _layout.tsx. on
  // windows the resolved target puts a backslash before each segment, which escapes a leading
  // "!(": every pattern needs another glob character to stay a glob
  layerZone(
    ['./app/*/**', './app/!(_layout).*', './app/_layout.!(tsx)'],
    IMPLEMENTATION_FOLDERS,
    'only app/_layout.tsx (the composition root) wires repository and catalog provider implementations',
  ),
  // every file of app/ and src/ except the colocated jest tests; the "**" keeps each pattern a glob
  // on windows, where the backslash before "!(" escapes it (see above)
  layerZone(
    ['./app/**/!(*.test.ts|*.test.tsx)', './src/**/!(*.test.ts|*.test.tsx)'],
    './test',
    'production code never imports the test infrastructure in test/: only tests do',
  ),
];
