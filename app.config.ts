import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Tsuzuki',
  slug: 'tsuzuki',
  version: '0.1.0', // x-release-please-version
  scheme: 'tsuzuki',
  orientation: 'portrait',
  plugins: ['expo-router'],
};

// expo loads the app config from the default export
export default config;
