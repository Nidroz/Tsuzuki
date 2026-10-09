/**
 * thrown when the app env (build-time configuration, ADR-0012) is invalid.
 * the message lists the invalid field names only: values (keys, DSN) are never included.
 */
export class AppEnvError extends Error {
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(`Invalid app env: ${fields.join(', ')}`);
    this.name = 'AppEnvError';
    this.fields = fields;
  }
}
