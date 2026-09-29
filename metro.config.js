// metro config: nativewind compiles the tailwind classes of src/ui (the only layer that uses
// NativeWind, CONTRIBUTING.md section 4) into react native styles
const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const THEME_DIR = path.join(__dirname, 'src', 'ui', 'theme');

module.exports = withNativeWind(getDefaultConfig(__dirname), {
  input: path.join(THEME_DIR, 'global.css'),
  configPath: path.join(THEME_DIR, 'tailwind.config.ts'),
  // nativewind would write a nativewind-env.d.ts at the root and rewrite tsconfig.json to include
  // it: the types reference lives in src/ui/nativewind-env.d.ts instead
  disableTypeScriptGeneration: true,
});
