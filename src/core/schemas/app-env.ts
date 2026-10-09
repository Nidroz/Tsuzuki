import { z } from 'zod';

import { AppEnvError } from '../errors/app-env-error';

// imported by app.config.ts at build time: plain typescript and zod only, no path alias, no react

/** app variants (ADR-0012): each one has its own app id, storage and EAS environment. */
export const APP_VARIANTS = ['development', 'preview', 'production'] as const;

// https origin only: no credentials, path, query or fragment (an optional trailing slash is kept)
const SUPABASE_URL_PATTERN = /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d{1,5})?\/?$/i;

// sentry dsn: https://<public key>@<host>/<project id>; the public key is the only userinfo allowed
const SENTRY_DSN_PATTERN =
  /^https:\/\/[a-f0-9]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d{1,5})?\/(?:[a-z0-9-]+\/)*\d+$/i;

const PUBLISHABLE_KEY_PREFIX = 'sb_publishable_';
const PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]+$/;
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/;
const ANON_ROLE = 'anon';

const jwtPayloadSchema = z.object({ role: z.string() });

// reads the role claim of a jwt without verifying it; undefined when the payload is unreadable
const readJwtRole = (token: string): string | undefined => {
  const payload = JWT_PATTERN.exec(token)?.[1];
  if (payload === undefined) {
    return undefined;
  }
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const result = jwtPayloadSchema.safeParse(JSON.parse(json));
    return result.success ? result.data.role : undefined;
  } catch {
    // malformed base64 or json: the caller rejects the key
    return undefined;
  }
};

// fail closed: only a publishable key or a legacy jwt whose role is anon is accepted, so a
// secret key (`sb_secret_...`) or a service_role jwt never ships in the app
const isPublicSupabaseKey = (key: string): boolean =>
  key.startsWith(PUBLISHABLE_KEY_PREFIX)
    ? PUBLISHABLE_KEY_PATTERN.test(key)
    : readJwtRole(key) === ANON_ROLE;

/** build-time configuration of the app, validated by app.config.ts and again at startup. */
export const appEnvSchema = z.object({
  supabaseUrl: z.string().regex(SUPABASE_URL_PATTERN),
  supabaseAnonKey: z.string().min(1).refine(isPublicSupabaseKey),
  // an empty dsn means sentry is not configured
  sentryDsn: z
    .string()
    .optional()
    .transform((value) => (value === '' ? undefined : value))
    .pipe(z.string().regex(SENTRY_DSN_PATTERN).optional()),
  variant: z.enum(APP_VARIANTS),
});

export type AppVariant = (typeof APP_VARIANTS)[number];

export interface AppEnv {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly sentryDsn?: string;
  readonly variant: AppVariant;
}

const ROOT_FIELD = 'env';

/** parses the app env; throws an `AppEnvError` naming the invalid fields, never their values. */
export const parseAppEnv = (input: unknown): AppEnv => {
  const result = appEnvSchema.safeParse(input);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => {
      const field = issue.path[0];
      return field === undefined ? ROOT_FIELD : String(field);
    });
    throw new AppEnvError([...new Set(fields)]);
  }
  const { sentryDsn, ...env } = result.data;
  return sentryDsn === undefined ? env : { ...env, sentryDsn };
};
