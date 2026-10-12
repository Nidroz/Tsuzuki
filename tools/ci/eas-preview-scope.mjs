// whether a push to dev runs the staging preview build (eas-preview.yml): only when a file of the
// app bundle or its native config changed, because the eas build quota is limited (ADR-0012). the
// migrations are never gated: supabase db push applies only the pending ones, so it runs on every
// workflow run. these lists are the single source of truth of the workflow's push paths filter,
// which repeats them in the same order

// the database migrations. they no longer select any step; they stay listed because the workflow's
// push paths filter includes them, so that a migration-only push still triggers the workflow and
// applies the migration
export const MIGRATION_PATHS = ['supabase/migrations/**'];

// the app bundle (routes, features, ui, core, platform, assets), the native config (app config,
// eas profiles and the expo config hook), the dependencies and the bundler config (babel, metro,
// and the path aliases of tsconfig.json). tailwind and global css live in src/ui/theme
export const BUILD_PATHS = [
  'app/**',
  'src/**',
  'assets/**',
  'tools/expo/**',
  'app.config.ts',
  'eas.json',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'babel.config.js',
  'metro.config.js',
  'tsconfig.json',
];

// files under those paths that change neither the bundle nor the database: docs and tests
export const IGNORED_PATHS = ['**/*.md', '**/*.test.ts', '**/*.test.tsx', '**/*.test.mjs'];

const GLOBSTAR_SUFFIX = '/**';
const GLOBSTAR_PREFIX = '**/';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// the subset of github's glob syntax the lists use: a trailing /** (anything below a folder), a
// leading **/ (in any folder, the root included) and * (anything but a slash)
export const globToRegExp = (glob) => {
  let rest = glob;
  let prefix = '';
  let suffix = '';
  if (rest.startsWith(GLOBSTAR_PREFIX)) {
    prefix = '(?:.*/)?';
    rest = rest.slice(GLOBSTAR_PREFIX.length);
  }
  if (rest.endsWith(GLOBSTAR_SUFFIX)) {
    suffix = '/.+';
    rest = rest.slice(0, -GLOBSTAR_SUFFIX.length);
  }
  const body = rest.split('*').map(escapeRegExp).join('[^/]*');
  return new RegExp(`^${prefix}${body}${suffix}$`);
};

const matcher = (globs) => {
  const patterns = globs.map(globToRegExp);
  return (file) => patterns.some((pattern) => pattern.test(file));
};

const isIgnored = matcher(IGNORED_PATHS);
const isBuildInput = matcher(BUILD_PATHS);

/**
 * whether the changed files need a preview build. paths are relative to the repository root with
 * forward slashes, as git diff --name-only prints them; blank entries are skipped
 */
export const classifyChanges = (paths) => ({
  build: paths
    .map((file) => file.trim())
    .some((file) => file !== '' && !isIgnored(file) && isBuildInput(file)),
});

/** the GITHUB_OUTPUT line of a scope: build=true|false */
export const formatOutputs = ({ build }) => `build=${String(build)}\n`;
