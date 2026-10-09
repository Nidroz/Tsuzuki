// metro config: sentry's expo config (debug ids in the bundle and its source maps, sentry frames
// collapsed in logbox) as the base, then nativewind, which compiles the tailwind classes of src/ui
// (the only layer that uses NativeWind, CONTRIBUTING.md section 4) into react native styles
const path = require('node:path');

const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { withNativeWind } = require('nativewind/metro');

const THEME_DIR = path.join(__dirname, 'src', 'ui', 'theme');

module.exports = withNativeWind(getSentryExpoConfig(__dirname), {
  input: path.join(THEME_DIR, 'global.css'),
  configPath: path.join(THEME_DIR, 'tailwind.config.ts'),
  // nativewind would write a nativewind-env.d.ts at the root and rewrite tsconfig.json to include
  // it: the types reference lives in src/ui/nativewind-env.d.ts instead
  disableTypeScriptGeneration: true,
});
