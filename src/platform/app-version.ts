import Constants from 'expo-constants';

// used when the native manifest carries no version (never expected in a build): every such run
// shares this value, so the persisted cache is still kept apart from versioned builds
export const UNKNOWN_APP_VERSION = '0.0.0-unknown';

/** the app version from app.config.ts, the persisted cache buster */
export const APP_VERSION: string = Constants.expoConfig?.version ?? UNKNOWN_APP_VERSION;
