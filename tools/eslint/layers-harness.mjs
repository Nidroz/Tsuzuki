// eslint node api harness for the layer rule tests: probes are virtual files (lintText), never written
// to disk. the overrides below only make virtual files lintable; the rules under test are the real
// config's (eslint.config.mjs)

import assert from 'node:assert/strict';
import path from 'node:path';

import { ESLint } from 'eslint';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import ts from 'typescript';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');

export const LAYER_RULE_IDS = [
  'import-x/no-restricted-paths',
  '@typescript-eslint/no-restricted-imports',
  'no-restricted-syntax',
  'no-restricted-globals',
  'no-restricted-properties',
];

// virtual probe paths, relative to the root: none of them may exist, since allowDefaultProject must
// not match a file of the project. existing files (EXISTING below) are linted with their project and
// must not be listed
export const PROBES = {
  core: 'src/core/probe.ts',
  coreTest: 'test/core/probe.test.ts',
  coreTestSource: 'test/core/probe.ts',
  hooks: 'src/core/hooks/probe.ts',
  domain: 'src/core/domain/probe.ts',
  // root interface files, next to the implementation folders
  repositoryInterface: 'src/core/repositories/library-repository.ts',
  catalogInterface: 'src/core/catalog/catalog-provider.ts',
  jikan: 'src/core/catalog/jikan/probe.ts',
  i18n: 'src/core/i18n/probe.ts',
  i18nTest: 'src/core/i18n/probe.test.ts',
  supabase: 'src/core/repositories/supabase/probe.ts',
  local: 'src/core/repositories/local/probe.ts',
  ui: 'src/ui/probe.ts',
  platform: 'src/platform/probe.ts',
  features: 'src/features/probe.ts',
  // files under src/ outside the four layers
  srcRoot: 'src/probe.ts',
  srcOther: 'src/utils/probe.ts',
  // colocated jest tests inside the layers
  featuresTest: 'src/features/probe.test.ts',
  featuresTestComponent: 'src/features/probe.test.tsx',
  // test data next to the code, outside the jest tests
  featuresFixture: 'src/features/__fixtures__/probe.tsx',
  hooksTest: 'src/core/hooks/probe.test.ts',
  uiTest: 'src/ui/probe.test.ts',
  uiTestComponent: 'src/ui/probe.test.tsx',
  platformTest: 'src/platform/probe.test.ts',
  // components (.tsx) inside and outside src/ui
  featuresComponent: 'src/features/probe.tsx',
  hooksComponent: 'src/core/hooks/probe.tsx',
  platformComponent: 'src/platform/probe.tsx',
  uiComponent: 'src/ui/probe.tsx',
  testMobileComponent: 'test/mobile/probe.tsx',
  layoutTs: 'app/_layout.ts',
  // the shapes of app/(tabs)/_layout.tsx and app/media/[kind]/[id].tsx, under names no route uses
  nestedLayout: 'app/(probe)/_layout.tsx',
  nestedRoute: 'app/probe/[kind]/[id].tsx',
  // dotfiles and dot-folders: plain modules (.mjs), since typescript leaves ts dotfiles out of the
  // project
  featuresDotfile: 'src/features/.probe.mjs',
  coreDotfile: 'src/core/.probe.mjs',
  hooksDotFolder: 'src/core/hooks/.probe/probe.mjs',
  // the deepest dot-folder nesting a globstar target covers (tools/eslint/glob-dot-names.mjs)
  hooksNestedDotFolders: 'src/core/hooks/.a/.b/probe.mjs',
  // node-only tooling and root tool configs
  tools: 'tools/probe.mjs',
  toolsTest: 'tools/probe.test.mjs',
  rootConfig: 'probe.config.mjs',
};

// real files, linted with injected code: the root layout, the Discover route (the path /) and the
// not-found route, which only means something at the root of app/
export const EXISTING = {
  layout: 'app/_layout.tsx',
  index: 'app/(tabs)/index.tsx',
  notFound: 'app/+not-found.tsx',
};

// allowDefaultProject takes minimatch globs: escape the characters of expo-router file names, and
// the backslash itself (the escape character), so the glob matches the name literally
export const literalGlob = (file) => file.replaceAll(/[\\[\]()*?!+@{}]/g, '\\$&');

const probeProjectService = {
  languageOptions: {
    parserOptions: {
      projectService: {
        allowDefaultProject: Object.values(PROBES).map(literalGlob),
        defaultProject: 'tsconfig.json',
        maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: Object.keys(PROBES).length,
      },
    },
  },
};

// alias prefixes from tsconfig.json paths, e.g. "@core/" -> "<root>/src/core/"
const readAliases = () => {
  const { config, error } = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(error, undefined, 'tsconfig.json must be readable');
  return Object.entries(config.compilerOptions.paths).map(([alias, [target]]) => [
    alias.replace(/\*$/, ''),
    path.join(ROOT, target.replace(/\*$/, '')),
  ]);
};

const ALIASES = readAliases();
const SYNTHETIC_ROOTS = [path.join(ROOT, 'src'), path.join(ROOT, 'app')].map(
  (dir) => dir + path.sep,
);

// same options as eslint.config.mjs
const typescriptResolver = createTypeScriptImportResolver({
  alwaysTryTypes: true,
  project: path.join(ROOT, 'tsconfig.json'),
});

const syntheticTarget = (modulePath, sourceFile) => {
  const alias = ALIASES.find(([prefix]) => modulePath.startsWith(prefix));
  const target = alias
    ? path.join(alias[1], modulePath.slice(alias[0].length))
    : /^\.{1,2}\//.test(modulePath) && path.resolve(path.dirname(sourceFile), modulePath);
  return target && SYNTHETIC_ROOTS.some((root) => target.startsWith(root)) ? `${target}.ts` : null;
};

// no-restricted-paths skips imports that do not resolve, and most layer targets (implementation
// folders included) do not exist yet: real resolution first, then a synthetic path for aliases and
// relative paths landing in src/ or app/
export const hybridResolver = {
  interfaceVersion: 3,
  name: 'layers-test-hybrid-resolver',
  resolve(modulePath, sourceFile) {
    const real = typescriptResolver.resolve(modulePath, sourceFile);
    if (real.found) {
      return real;
    }
    const target = syntheticTarget(modulePath, sourceFile);
    return target ? { found: true, path: target } : { found: false };
  },
};

// one instance per configuration, reused by every case
export const layersEslint = new ESLint({
  cwd: ROOT,
  overrideConfig: [
    probeProjectService,
    {
      settings: { 'import-x/resolver-next': [hybridResolver] },
      // its case check crashes on synthetic targets in missing folders; the guard is proved with
      // guardEslint below
      rules: { 'import-x/no-unresolved': 'off' },
    },
  ],
});

// the real resolver and every real rule, no-unresolved included
export const guardEslint = new ESLint({ cwd: ROOT, overrideConfig: [probeProjectService] });

const describeMessages = (messages) =>
  messages.map(({ ruleId, message }) => `  ${ruleId ?? '(no rule)'}: ${message}`).join('\n') ||
  '  (no message)';

export const lint = async (eslint, file, code) => {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  assert.ok(result, `no lint result for ${file}`);
  // a parse error or an ignored file would make every positive control pass vacuously
  const fatal = result.messages.filter(({ fatal: isFatal, ruleId }) => isFatal || ruleId === null);
  assert.deepEqual(fatal, [], `${file} must be parsed and linted:\n${describeMessages(fatal)}`);
  return result.messages;
};

export const assertReported = (messages, ruleId, fragment) => {
  const found = messages.some(
    (message) => message.ruleId === ruleId && message.message.includes(fragment),
  );
  assert.ok(
    found,
    `expected ${ruleId} containing "${fragment}", got:\n${describeMessages(messages)}`,
  );
};

export const assertNoLayerViolation = (messages) => {
  const violations = messages.filter(({ ruleId }) => LAYER_RULE_IDS.includes(ruleId));
  assert.deepEqual(
    violations,
    [],
    `expected no layer rule violation, got:\n${describeMessages(violations)}`,
  );
};
