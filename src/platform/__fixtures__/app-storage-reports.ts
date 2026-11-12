import {
  APP_STORAGE_REPORT_SOURCE,
  AppStorageError,
  type AppStorageProblem,
} from '@core/errors/app-storage-errors';
import type { ErrorReporter } from '@core/errors/error-reporter';
import { expect, type jest } from '@jest/globals';

import { knownSecrets } from './app-storage-device';

type CaptureError = jest.Mock<ErrorReporter['captureError']>;

// what a report carries: the error's name, message and own fields, and the context
const serializeReports = (captureError: CaptureError): string =>
  JSON.stringify(
    captureError.mock.calls.map(([error, context]) => [
      error instanceof Error
        ? {
            ...Object.fromEntries(Object.entries(error)),
            name: error.name,
            message: error.message,
          }
        : error,
      context,
    ]),
  );

/**
 * the problems reported, in order. fails the test unless every report is an AppStorageError with
 * no cause and the app storage source alone, and no report quotes a key or a stored value
 */
export const reportedProblems = (captureError: CaptureError): AppStorageProblem[] => {
  const problems = captureError.mock.calls.map(([error, context]) => {
    expect(context).toStrictEqual({ source: APP_STORAGE_REPORT_SOURCE });
    expect(error).toBeInstanceOf(AppStorageError);
    expect(error).not.toHaveProperty('cause');
    return error instanceof AppStorageError ? error.problem : undefined;
  });
  const reported = serializeReports(captureError);
  for (const secret of knownSecrets()) {
    expect(reported).not.toContain(secret);
  }
  return problems.filter((problem) => problem !== undefined);
};
