import type { ErrorContext, ErrorReporter } from '@core/errors/error-reporter';
import type { AppEnv } from '@core/schemas/app-env';
import * as Sentry from '@sentry/react-native';

import { scrubBreadcrumb, scrubEvent } from './sentry-scrub';

// the tag naming the module that reported an error (ErrorContext.source)
const SOURCE_TAG = 'source';
// the console label of an error reported without a context
const UNKNOWN_SOURCE = 'error';

/** sentry runs in release builds with a dsn only: never in development, never without a dsn */
export const isSentryEnabled = (env: AppEnv, isDevelopment: boolean = __DEV__): boolean =>
  !isDevelopment && env.sentryDsn !== undefined;

/**
 * initializes sentry for errors only (ADR-0012): no performance tracing (no tracesSampleRate, so
 * no tracing integration), no session replay, no screenshot or view hierarchy, no failed request
 * capture, no default pii. every event and breadcrumb is scrubbed before it leaves the device.
 * release and dist come from the native app. returns whether sentry was started
 */
export const initSentry = (env: AppEnv, isDevelopment: boolean = __DEV__): boolean => {
  if (!isSentryEnabled(env, isDevelopment) || env.sentryDsn === undefined) {
    return false;
  }
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.variant,
    sendDefaultPii: false,
    enableAutoPerformanceTracing: false,
    enableAppStartTracking: false,
    enableNativeFramesTracking: false,
    enableStallTracking: false,
    enableUserInteractionTracing: false,
    enableCaptureFailedRequests: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  return true;
};

const tagsOf = (context: ErrorContext | undefined): Record<string, string> | undefined =>
  context && { ...context.tags, [SOURCE_TAG]: context.source };

/**
 * the ErrorReporter of the app: sentry when it was started, otherwise the console in development
 * (this is the only production file allowed to use it) and nothing in a release without a dsn
 */
export const createErrorReporter = (
  sentryEnabled: boolean,
  isDevelopment: boolean = __DEV__,
): ErrorReporter => ({
  captureError: (error, context) => {
    if (sentryEnabled) {
      const tags = tagsOf(context);
      Sentry.captureException(error, tags && { tags });
    } else if (isDevelopment) {
      console.warn(`[${context?.source ?? UNKNOWN_SOURCE}]`, error);
    }
  },
});
