import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Tsuzuki',
  slug: 'tsuzuki',
  version: '0.1.0', // x-release-please-version
  scheme: 'tsuzuki',
  orientation: 'portrait',
  // follows the system light/dark setting; expo-system-ui applies it natively (its config plugin
  // is applied automatically by prebuild)
  userInterfaceStyle: 'automatic',
  plugins: ['expo-router'],
};

// expo loads the app config from the default export
export default config;
