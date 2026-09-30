// babel config shared by metro and both jest projects. nativewind's jsx transform is scoped to
// src/ui, the only layer that uses NativeWind (CONTRIBUTING.md section 4): applied globally, it
// would pull react-native-css-interop, and with it react native, into src/core modules
const path = require('node:path');

const UI_DIR = path.join(__dirname, 'src', 'ui');

// babel passes absolute file names with the platform separator; path.relative normalizes both
// separators on windows
const isInsideUi = (filename) => {
  if (typeof filename !== 'string') {
    return false;
  }
  const relative = path.relative(UI_DIR, filename);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

// babel resolves the plugin names returned by nativewind/babel from this folder, not from the
// preset's own package: @babel/plugin-transform-react-jsx is a root devDependency so the build
// also works without the NODE_PATH that pnpm's .bin shims set (gradle runs node directly)
module.exports = (api) => {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    overrides: [
      {
        test: isInsideUi,
        presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
      },
    ],
  };
};
