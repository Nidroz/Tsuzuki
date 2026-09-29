// regression tests for tsuzuki/file-name-case with eslint's RuleTester (CONTRIBUTING.md section 5)

import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Linter, RuleTester } from 'eslint';

import { tsuzukiPlugin } from '../index.mjs';
import { fileNameCase } from './file-name-case.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

// the rule checks paths relative to the eslint cwd, the repo root under `pnpm test:tooling`
const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const CODE = 'export const value = 1;\n';
const CJS_CODE = 'module.exports = {};\n';

const file = (relative) => path.join(ROOT, ...relative.split('/'));

// every report sits at line 1, column 1
const error = (messageId, segment) => ({
  messageId,
  data: { segment },
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
});

const VALID_PATHS = [
  // components, their tests and platform variants
  'src/ui/components/MediaCard.tsx',
  'src/ui/components/MediaCard.test.tsx',
  'src/ui/components/MediaCard.ios.tsx',
  // kebab-case folders and files
  'src/features/media-detail/use-media.ts',
  'src/core/query/keys.ts',
  'src/core/i18n/fr.ts',
  'src/types/env.d.ts',
  // test tooling folders
  'src/core/__tests__/x.test.ts',
  'src/core/__mocks__/x.ts',
  'src/features/search/__mocks__/x.ts',
  'src/core/catalog/jikan/__fixtures__/search-page.ts',
  // expo-router names inside app/
  'app/_layout.tsx',
  'app/index.tsx',
  'app/test.tsx',
  'app/(tabs)/_layout.tsx',
  'app/(auth)/sign-in.tsx',
  'app/media/[kind]/[id].tsx',
  'app/[userId].tsx',
  'app/[...slug].tsx',
  'app/docs/[...slug].tsx',
  'app/(tabs)/[...rest]/index.tsx',
  'app/+not-found.tsx',
  'app/+html.tsx',
  'app/+native-intent.tsx',
  // root config files and route tests outside app/
  'app.config.ts',
  'eslint.config.mjs',
  'lint-staged.config.mjs',
  'test/app/root-layout.test.tsx',
  // dotfiles and dot-folders outside app/: the part after the leading dot is kebab-case
  '.prettierrc.mjs',
  '.storybook/main.ts',
  '.storybook/preview.tsx',
  '.github/x.mjs',
  '.github/scripts/check-base.mjs',
  'tools/.cache-probe/x.mjs',
];

// expo-router API routes: server logic lives in Supabase Edge Functions
const API_ROUTE_FRAGMENT =
  'expo-router API routes (+api) are not used: server logic lives in Supabase Edge Functions';
const API_ROUTES = ['app/users+api.ts', 'app/api/[id]+api.ts', 'app/(group)/x+api.ts'];
// outside app/ a "+" is simply not kebab-case
const API_ROUTES_OUTSIDE_APP = ['src/users+api.ts', 'src/core/x+api.ts'];

const INVALID_CASES = [
  // folders
  ['src/Core/x.ts', [error('invalidSegment', 'Core')]],
  ['src/features/media_detail/x.ts', [error('invalidSegment', 'media_detail')]],
  ['src/(group)/x.ts', [error('invalidSegment', '(group)')]],
  ['src/[id]/x.ts', [error('invalidSegment', '[id]')]],
  ['app/(Tabs)/x.tsx', [error('invalidSegment', '(Tabs)')]],
  ['app/(tabs-)/x.tsx', [error('invalidSegment', '(tabs-)')]],
  ['app/[Kind]/index.tsx', [error('invalidSegment', '[Kind]')]],
  // test tooling folders inside app/: expo-router bundles every file in app/ as a route
  ['app/__tests__/helpers.ts', [error('invalidSegment', '__tests__')]],
  ['app/__fixtures__/search-page.ts', [error('invalidSegment', '__fixtures__')]],
  ['app/(tabs)/__mocks__/x.ts', [error('invalidSegment', '__mocks__')]],
  // file names outside app/
  ['src/ui/components/media_card.tsx', [error('invalidFileName', 'media_card.tsx')]],
  ['src/core/MediaCard.ts', [error('invalidFileName', 'MediaCard.ts')]],
  ['src/core/MediaCard.test.ts', [error('invalidFileName', 'MediaCard.test.ts')]],
  ['src/core/fooBar.ts', [error('invalidFileName', 'fooBar.ts')]],
  ['src/x.Test.ts', [error('invalidFileName', 'x.Test.ts')]],
  ['src/media-card.TSX', [error('invalidFileName', 'media-card.TSX')]],
  ['src/[id].ts', [error('invalidFileName', '[id].ts')]],
  ['src/_layout.tsx', [error('invalidFileName', '_layout.tsx')]],
  // file names inside app/
  ['app/MediaCard.tsx', [error('invalidFileName', 'MediaCard.tsx')]],
  ['app/_other.tsx', [error('invalidFileName', '_other.tsx')]],
  ['app/[Bad].tsx', [error('invalidFileName', '[Bad].tsx')]],
  ['app/[user_id].tsx', [error('invalidFileName', '[user_id].tsx')]],
  ['app/[].tsx', [error('invalidFileName', '[].tsx')]],
  ['app/[...Slug].tsx', [error('invalidFileName', '[...Slug].tsx')]],
  // a catch-all base ends at "]": only a dot may follow it
  ['app/[...slug]-x.tsx', [error('invalidFileName', '[...slug]-x.tsx')]],
  ['app/[...slug]x.tsx', [error('invalidFileName', '[...slug]x.tsx')]],
  ['app/[...slug]xy.tsx', [error('invalidFileName', '[...slug]xy.tsx')]],
  ['app/docs/[...slug]-x.tsx', [error('invalidFileName', '[...slug]-x.tsx')]],
  ['app/+unknown.tsx', [error('invalidFileName', '+unknown.tsx')]],
  // expo-router API routes get a dedicated message instead of the generic one
  ...API_ROUTES.map((relative) => [relative, [error('apiRoute', path.posix.basename(relative))]]),
  // dotfiles and dot-folders: the part after the leading dot must be kebab-case
  ['.Prettierrc.mjs', [error('invalidFileName', '.Prettierrc.mjs')]],
  ['.my_config.mjs', [error('invalidFileName', '.my_config.mjs')]],
  ['..x.mjs', [error('invalidFileName', '..x.mjs')]],
  ['.-x.mjs', [error('invalidFileName', '.-x.mjs')]],
  ['.Storybook/main.ts', [error('invalidSegment', '.Storybook')]],
  ['tools/.cache_probe/x.mjs', [error('invalidSegment', '.cache_probe')]],
  ['.../x.mjs', [error('invalidSegment', '...')]],
  // every file in app/ is a route: no dotfile or dot-folder there
  ['app/.hidden/x.tsx', [error('invalidSegment', '.hidden')]],
  ['app/.hidden.tsx', [error('invalidFileName', '.hidden.tsx')]],
  // tests inside app/
  ['app/index.test.tsx', [error('testInApp', 'index.test.tsx')]],
  ['app/x.spec.ts', [error('testInApp', 'x.spec.ts')]],
  ['app/(tabs)/_layout.test.tsx', [error('testInApp', '_layout.test.tsx')]],
  ['app/[id].test.tsx', [error('testInApp', '[id].test.tsx')]],
  ['app/[...slug].spec.tsx', [error('testInApp', '[...slug].spec.tsx')]],
  // several problems in one path, reported in path order
  [
    'src/Core/Bad_Name.ts',
    [error('invalidSegment', 'Core'), error('invalidFileName', 'Bad_Name.ts')],
  ],
  [
    'app/(Tabs)/Index.test.tsx',
    [
      error('invalidSegment', '(Tabs)'),
      error('invalidFileName', 'Index.test.tsx'),
      error('testInApp', 'Index.test.tsx'),
    ],
  ],
];

const ruleTester = new RuleTester();

describe('test environment', () => {
  it('runs from the repo root, which the rule resolves paths against', () => {
    assert.equal(path.relative(process.cwd(), ROOT), '');
  });

  it('registers the rule in the tsuzuki plugin', () => {
    assert.equal(tsuzukiPlugin.rules['file-name-case'], fileNameCase);
  });
});

ruleTester.run('file-name-case', fileNameCase, {
  assertionOptions: { requireMessage: 'messageId', requireLocation: true, requireData: true },
  valid: [
    ...VALID_PATHS.map((relative) => ({ name: relative, code: CODE, filename: file(relative) })),
    // a .cjs file is parsed as CommonJS, where export is a syntax error
    { name: '.eslintrc.cjs', code: CJS_CODE, filename: file('.eslintrc.cjs') },
    // files outside cwd, relative (virtual) names and no name at all are not checked
    {
      name: 'outside cwd: ../Other/Bad_Name.js',
      code: CODE,
      filename: path.resolve(ROOT, '..', 'Other', 'Bad_Name.js'),
    },
    {
      name: 'relative name: src/Bad_Name.ts',
      code: CODE,
      filename: path.join('src', 'Bad_Name.ts'),
    },
    { name: 'no file name', code: CODE },
  ],
  invalid: [
    ...INVALID_CASES.map(([relative, errors]) => ({
      name: relative,
      code: CODE,
      filename: file(relative),
      errors,
    })),
    // the report stays on line 1 when the program starts after leading comments
    {
      name: 'src/core/fooBar.ts after leading comments',
      code: `// header\n\n${CODE}`,
      filename: file('src/core/fooBar.ts'),
      errors: [error('invalidFileName', 'fooBar.ts')],
    },
  ],
});

// messages of tsuzuki/file-name-case for a file, through the plugin as eslint.config.mjs registers it
const fileNameMessages = (relative) => {
  const messages = new Linter({ cwd: ROOT }).verify(
    CODE,
    [
      {
        // "**/*" alone matches no file in flat config: the extensions make the files lintable
        files: ['**/*.{ts,tsx,mjs}'],
        plugins: { tsuzuki: tsuzukiPlugin },
        rules: { 'tsuzuki/file-name-case': 'error' },
      },
    ],
    { filename: file(relative) },
  );
  // an unmatched file ("no matching configuration") would make every check pass vacuously
  const unlinted = messages.filter(({ ruleId }) => ruleId === null);
  assert.deepEqual(unlinted, [], `${relative} must be linted`);
  return messages.filter(({ ruleId }) => ruleId === 'tsuzuki/file-name-case');
};

describe('file-name-case: expo-router API routes', () => {
  for (const relative of API_ROUTES) {
    it(`explains why ${relative} is rejected`, () => {
      const messages = fileNameMessages(relative);
      assert.ok(
        messages.some(({ message }) => message.includes(API_ROUTE_FRAGMENT)),
        messages.map(({ message }) => message).join('\n') || '(no message)',
      );
    });
  }

  for (const relative of API_ROUTES_OUTSIDE_APP) {
    it(`rejects ${relative} outside app/`, () => {
      assert.notDeepEqual(fileNameMessages(relative), []);
    });
  }

  // positive control: the helper reports nothing for a valid file
  it('reports nothing for app/+not-found.tsx', () => {
    assert.deepEqual(fileNameMessages('app/+not-found.tsx'), []);
  });
});

describe('file-name-case options schema', () => {
  it('takes no option', () => {
    assert.throws(
      () =>
        new Linter().verify(CODE, [
          {
            plugins: { tsuzuki: tsuzukiPlugin },
            rules: { 'tsuzuki/file-name-case': ['error', 'strict'] },
          },
        ]),
      /tsuzuki\/file-name-case/,
    );
  });
});
