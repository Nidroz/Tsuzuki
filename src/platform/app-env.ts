import type { AppEnv } from '@core/schemas/app-env';
import Constants from 'expo-constants';

/** the core app env parser (`parseAppEnv`), injected by the composition root */
export type AppEnvParser = (input: unknown) => AppEnv;

/**
 * reads the app env that app.config.ts validated into `extra.env` (ADR-0012) and re-parses it: the
 * native manifest is an input like any other. src/platform imports core types only, so the
 * composition root passes the core parser. a missing or invalid env throws (fail closed) before
 * any client is created
 */
export const readAppEnv = (parse: AppEnvParser): AppEnv => parse(Constants.expoConfig?.extra?.env);
