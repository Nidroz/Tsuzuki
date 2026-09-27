// lint-staged passes explicit file paths: prettier still honors ignore files for them, but any
// --ignore-path replaces its defaults, so the three files match the `format` scripts (package.json)
const PRETTIER =
  'prettier --write --ignore-unknown --ignore-path .gitignore --ignore-path .prettierignore --ignore-path .git/info/exclude';

// --no-warn-ignored: a staged file eslint ignores (e.g. under supabase/) would otherwise warn,
// and --max-warnings 0 would turn that warning into a failed commit
const ESLINT = 'eslint --fix --max-warnings 0 --no-warn-ignored';

export default {
  '*.{ts,tsx,js,mjs,cjs}': [ESLINT, PRETTIER],
  // pnpm-lock.yaml matches this glob but is listed in .prettierignore, so prettier skips it
  '*.{json,yml,yaml}': PRETTIER,
};
