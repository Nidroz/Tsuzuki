/**
 * non-personal context attached to a reported error. never put emails, tokens, notes or any
 * user data here: `source` names the reporting module, `tags` are short searchable labels.
 */
export interface ErrorContext {
  readonly source: string;
  readonly tags?: Readonly<Record<string, string>>;
}

/**
 * error reporting port (Sentry on mobile, implemented in `src/platform/sentry.ts`).
 * injected by the composition root; implementations scrub personal data before sending
 * and never throw.
 */
export interface ErrorReporter {
  captureError(error: unknown, context?: ErrorContext): void;
}
