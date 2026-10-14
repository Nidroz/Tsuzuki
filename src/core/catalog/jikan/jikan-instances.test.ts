import { describe, expect, it } from '@jest/globals';

import { MEDIA_ID_NAMESPACES } from '../../domain/media';
import {
  JIKAN_NAMESPACE,
  SELF_HOSTED_JIKAN_ID,
  TENRAI_INSTANCE,
  jikanInstanceFor,
  selfHostedJikanInstance,
} from './jikan-instances';
import { SELF_HOSTED_JIKAN_RATE_LIMIT, TENRAI_RATE_LIMIT } from './jikan-rate-limit';

// spelled out: a wrong constant is caught
const TENRAI_URL = 'https://api.tenrai.org/v1';
const SELF_HOSTED_URL = 'https://jikan.example.test/v4';

// the message of the RangeError thrown by `build`, or null when it does not throw one
const rangeErrorOf = (build: () => unknown): string | null => {
  try {
    build();
  } catch (error: unknown) {
    return error instanceof RangeError ? error.message : null;
  }
  return null;
};

describe('JIKAN_NAMESPACE', () => {
  it('is the mal namespace', () => {
    expect(JIKAN_NAMESPACE).toBe('mal');
    expect(MEDIA_ID_NAMESPACES).toContain(JIKAN_NAMESPACE);
  });
});

describe('TENRAI_INSTANCE', () => {
  it('is tenrai, with its rate limit', () => {
    expect(TENRAI_INSTANCE).toStrictEqual({
      id: 'tenrai',
      baseUrl: TENRAI_URL,
      rateLimit: TENRAI_RATE_LIMIT,
    });
  });
});

describe('selfHostedJikanInstance', () => {
  it.each([SELF_HOSTED_URL, 'https://jikan.example.test:8443', 'https://localhost:4000/v4'])(
    'builds a self-hosted instance at %s with the conservative rate limit',
    (baseUrl) => {
      expect(selfHostedJikanInstance(baseUrl)).toStrictEqual({
        id: SELF_HOSTED_JIKAN_ID,
        baseUrl,
        rateLimit: SELF_HOSTED_JIKAN_RATE_LIMIT,
      });
    },
  );

  it('names every self-hosted instance alike, never by its url', () => {
    expect(SELF_HOSTED_JIKAN_ID).toBe('jikan-self-hosted');
    expect(selfHostedJikanInstance('https://private.example.test/v4').id).toBe(
      SELF_HOSTED_JIKAN_ID,
    );
  });

  it.each([
    ['http', 'http://private.example.test/v4'],
    ['no scheme', 'private.example.test/v4'],
    ['a trailing slash', 'https://private.example.test/v4/'],
    ['a trailing slash after the host', 'https://private.example.test/'],
    ['the empty string', ''],
  ])('rejects a url with %s, without quoting it', (_, baseUrl) => {
    const message = rangeErrorOf(() => selfHostedJikanInstance(baseUrl));

    expect(message).not.toBeNull();
    expect(message).not.toContain('private');
  });
});

describe('jikanInstanceFor', () => {
  it('gives tenrai without a configured url', () => {
    expect(jikanInstanceFor(undefined)).toBe(TENRAI_INSTANCE);
  });

  it('gives a self-hosted instance for a configured url', () => {
    expect(jikanInstanceFor(SELF_HOSTED_URL)).toStrictEqual(
      selfHostedJikanInstance(SELF_HOSTED_URL),
    );
  });

  it('gives a self-hosted instance with the conservative rate limit for the tenrai url too', () => {
    expect(jikanInstanceFor(TENRAI_URL)).toStrictEqual({
      id: SELF_HOSTED_JIKAN_ID,
      baseUrl: TENRAI_URL,
      rateLimit: SELF_HOSTED_JIKAN_RATE_LIMIT,
    });
  });

  it('rejects a configured url that is not https', () => {
    expect(rangeErrorOf(() => jikanInstanceFor('http://private.example.test'))).not.toBeNull();
  });
});
