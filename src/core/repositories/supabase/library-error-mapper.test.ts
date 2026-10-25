import { describe, expect, it } from '@jest/globals';

import { LibraryRemoteError } from '../../errors/library-errors';
import {
  LIBRARY_REPORT_SOURCE,
  libraryRemoteReason,
  libraryReportContext,
  toLibraryRemoteError,
  type LibraryFailure,
} from './library-error-mapper';

// server text quoting the row, as a 23505 detail does
const SERVER_TEXT = 'Key (user_id, external_id)=(00000000-0000-4000-8000-000000000001, 52991)';

const response = (status: number, code?: unknown): LibraryFailure => ({
  type: 'response',
  status,
  error: { code, message: SERVER_TEXT, details: SERVER_TEXT, hint: null },
});

describe('libraryRemoteReason', () => {
  it.each([0, 502, 503, 504])('reads status %p as network', (status) => {
    expect(libraryRemoteReason(response(status))).toBe('network');
  });

  it('reads a 401 and the session guard as signed-out', () => {
    expect(libraryRemoteReason(response(401))).toBe('signed-out');
    expect(libraryRemoteReason({ type: 'session' })).toBe('signed-out');
  });

  it.each([400, 403, 404, 406, 409, 499])('reads status %p as rejected', (status) => {
    expect(libraryRemoteReason(response(status, '23514'))).toBe('rejected');
  });

  it('reads a row the schema rejects as invalid-row', () => {
    expect(libraryRemoteReason({ type: 'invalid-row' })).toBe('invalid-row');
  });

  it.each([200, 201, 302, 500, 501, 520])('reads status %p as unknown', (status) => {
    expect(libraryRemoteReason(response(status))).toBe('unknown');
  });

  it('reads an error thrown by the client as unknown', () => {
    expect(libraryRemoteReason({ type: 'thrown', error: new Error(SERVER_TEXT) })).toBe('unknown');
  });
});

describe('toLibraryRemoteError', () => {
  it('keeps the reason only, with no server text and no cause', () => {
    const error = toLibraryRemoteError(response(409, '23505'));

    expect(error).toBeInstanceOf(LibraryRemoteError);
    expect(error.reason).toBe('rejected');
    expect(error.message).not.toContain(SERVER_TEXT);
    expect(error.cause).toBeUndefined();
  });
});

describe('libraryReportContext', () => {
  it.each(['23514', '23505', '42501', 'XX000', 'PGRST204', 'PGRST116'])(
    'tags the operation, the code %p and the status',
    (code) => {
      expect(libraryReportContext('save', response(400, code))).toStrictEqual({
        source: LIBRARY_REPORT_SOURCE,
        tags: { operation: 'save', code, status: '400' },
      });
    },
  );

  it.each([undefined, 42, 'abcde', 'PGRST1234', ' 23514', SERVER_TEXT])(
    'leaves out a code that is not an identifier: %p',
    (code) => {
      expect(libraryReportContext('get', response(400, code))).toStrictEqual({
        source: 'library-remote',
        tags: { operation: 'get', status: '400' },
      });
    },
  );

  it('tags the status of a response without an error body', () => {
    const failure: LibraryFailure = { type: 'response', status: 201, error: null };

    expect(libraryReportContext('save', failure).tags).toStrictEqual({
      operation: 'save',
      status: '201',
    });
  });

  it.each<LibraryFailure>([
    { type: 'response', status: 0, error: { code: '23514' } },
    { type: 'session' },
    { type: 'invalid-row' },
    { type: 'thrown', error: { code: '23514', message: SERVER_TEXT } },
  ])('tags the operation alone without a response ($type)', (failure) => {
    expect(libraryReportContext('list', failure)).toStrictEqual({
      source: 'library-remote',
      tags: { operation: 'list' },
    });
  });
});
