// first: lets node resolve the extensionless imports of the core schema below
import './tools/expo/resolve-ts-imports.cjs';

import type { ExpoConfig } from 'expo/config';

// relative import: the app config is loaded by the expo cli, which does not resolve path aliases
import { AppEnvError } from './src/core/errors/app-env-error';
import {
  APP_VARIANTS,
  parseAppEnv,
  type AppEnv,
  type AppVariant,
} from './src/core/schemas/app-env';

// one identifier for both stores, owned by the project's github namespace
const APP_ID = 'io.github.nidroz.tsuzuki';
const APP_NAME = 'Tsuzuki';

// the eas project id is public (it is sent with every build and update), not a secret. this config
// is dynamic, so `eas init` cannot write it here: it was printed by `eas init` and pasted by hand
const EAS_PROJECT_ID = '04d653a0-d0e2-4be0-a49e-8069e679ed05';

// sentry organization and project slugs and the eu data region url: public, not secrets. the auth
// token for the source map upload is never written here: the sentry build step reads
// SENTRY_AUTH_TOKEN, a secret of the eas environments preview and production (ADR-0012)
const SENTRY_ORGANIZATION = 'nidro-team';
const SENTRY_PROJECT = 'tsuzuki';
const SENTRY_URL = 'https://de.sentry.io/';

// one app id and name per variant, so the variants install side by side, each with its own
// storage and keychain (ADR-0012)
const VARIANTS: Readonly<Record<AppVariant, { idSuffix: string; nameSuffix: string }>> = {
  development: { idSuffix: '.dev', nameSuffix: ' (Dev)' },
  preview: { idSuffix: '.preview', nameSuffix: ' (Preview)' },
  production: { idSuffix: '', nameSuffix: '' },
};

// the variant of local tooling runs without APP_VARIANT (jest, lint, `expo config` without .env.local)
const FALLBACK_VARIANT: AppVariant = 'development';

// the build-time env of the eas environment, read by this config: every value is public and ships
// in the app. APP_VARIANT is read on its own (readVariant)
const SERVER_ENV_NAMES = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'SENTRY_DSN',
] as const;

const VARIANT_FIELD = 'variant';

const isAppVariant = (value: string): value is AppVariant =>
  (APP_VARIANTS as readonly string[]).includes(value);

// a valid APP_VARIANT selects the variant even without any other env: the eas cli evaluates this
// config locally with the build profile env only, and picks the credentials by app id. a missing or
// empty value falls back; an invalid one throws, naming the field but not its value
const readVariant = (): AppVariant => {
  const value = process.env.APP_VARIANT;
  if (value === undefined || value === '') {
    return FALLBACK_VARIANT;
  }
  if (!isAppVariant(value)) {
    throw new AppEnvError([VARIANT_FIELD]);
  }
  return value;
};

// the full env is always validated on the eas build worker. elsewhere (expo start, the local eas cli
// evaluation, jest, lint) it is validated only when a supabase or sentry value is set, so a partial
// or invalid local env still fails, with the variant falling back when APP_VARIANT is missing.
// without any of them, extra.env is left out and the app fails closed at startup
// (src/platform/app-env.ts)
const readAppEnv = (): AppEnv | undefined => {
  // throws an error naming the invalid fields, never their values: the build or `expo start` stops
  if (process.env.EAS_BUILD === 'true') {
    return parseAppEnv({
      variant: process.env.APP_VARIANT,
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      sentryDsn: process.env.SENTRY_DSN,
    });
  }
  const variant = readVariant();
  const hasServerEnv = SERVER_ENV_NAMES.some((name) => process.env[name] !== undefined);
  if (!hasServerEnv) {
    return undefined;
  }
  return parseAppEnv({
    variant,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    sentryDsn: process.env.SENTRY_DSN,
  });
};

const env = readAppEnv();
const variant = VARIANTS[env?.variant ?? readVariant()];
const appId = `${APP_ID}${variant.idSuffix}`;

const config: ExpoConfig = {
  name: `${APP_NAME}${variant.nameSuffix}`,
  slug: 'tsuzuki',
  version: '0.1.0', // x-release-please-version
  scheme: 'tsuzuki',
  orientation: 'portrait',
  // follows the system light/dark setting; expo-system-ui applies it natively (its config plugin
  // is applied automatically by prebuild, as is expo-dev-client's)
  userInterfaceStyle: 'automatic',
  ios: { bundleIdentifier: appId },
  android: { package: appId },
  // an update reaches only the binaries of the app version it was published from (ADR-0012)
  runtimeVersion: { policy: 'appVersion' },
  updates: { url: `https://u.expo.dev/${EAS_PROJECT_ID}` },
  plugins: [
    'expo-router',
    // the session is never unlocked with biometrics: no face id usage description. android auto
    // backup keeps excluding the secure-store data, whose keys cannot be restored on another device
    ['expo-secure-store', { faceIDPermission: false, configureAndroidBackup: true }],
    // the os per-app language setting lists the languages of the app (ADR-0011)
    ['expo-localization', { supportedLocales: ['en', 'fr'] }],
    // native crash reporting and source map upload during eas builds (disabled by the development
    // profile with SENTRY_DISABLE_AUTO_UPLOAD)
    [
      '@sentry/react-native/expo',
      { organization: SENTRY_ORGANIZATION, project: SENTRY_PROJECT, url: SENTRY_URL },
    ],
  ],
  // eas reads the project id from extra.eas.projectId; the app re-parses extra.env at startup
  extra: { eas: { projectId: EAS_PROJECT_ID }, ...(env && { env }) },
};

// expo loads the app config from the default export
export default config;
