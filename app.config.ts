import type { ExpoConfig } from 'expo/config';

// one identifier for both stores, owned by the project's github namespace
const APP_ID = 'io.github.nidroz.tsuzuki';

// the eas project id is public (it is sent with every build and update), not a secret. this config
// is dynamic, so `eas init` cannot write it here: it was printed by `eas init` and pasted by hand
const EAS_PROJECT_ID = '04d653a0-d0e2-4be0-a49e-8069e679ed05';

const config: ExpoConfig = {
  name: 'Tsuzuki',
  slug: 'tsuzuki',
  version: '0.1.0', // x-release-please-version
  scheme: 'tsuzuki',
  orientation: 'portrait',
  // follows the system light/dark setting; expo-system-ui applies it natively (its config plugin
  // is applied automatically by prebuild, as is expo-dev-client's)
  userInterfaceStyle: 'automatic',
  ios: { bundleIdentifier: APP_ID },
  android: { package: APP_ID },
  plugins: [
    'expo-router',
    // the session is never unlocked with biometrics: no face id usage description. android auto
    // backup keeps excluding the secure-store data, whose keys cannot be restored on another device
    ['expo-secure-store', { faceIDPermission: false, configureAndroidBackup: true }],
  ],
  // eas reads the project id from extra.eas.projectId
  extra: { eas: { projectId: EAS_PROJECT_ID } },
};

// expo loads the app config from the default export
export default config;
