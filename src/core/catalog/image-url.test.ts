import { describe, expect, it } from '@jest/globals';

import { IMAGE_URL_MAX_LENGTH, toAllowedImageUrl } from './image-url';

const HOSTS = ['cdn.myanimelist.net'] as const;
const ORIGIN = 'https://cdn.myanimelist.net';

// a valid url of exactly `length` characters
const urlOfLength = (length: number): string => {
  const prefix = `${ORIGIN}/images/`;
  const suffix = '.jpg';
  return `${prefix}${'a'.repeat(length - prefix.length - suffix.length)}${suffix}`;
};

describe('toAllowedImageUrl', () => {
  it.each([
    `${ORIGIN}/images/anime/1001/100001.jpg`,
    `${ORIGIN}/images/anime/1001/100001l.webp`,
    `${ORIGIN}/images/manga/2/200002l.jpg`,
    `${ORIGIN}/r/50x70/images/anime/3/300003.jpg?s=0a1b2c&v=2`,
  ])('keeps %s', (url) => {
    expect(toAllowedImageUrl(url, HOSTS)).toBe(url);
  });

  it.each([
    ['http', 'http://cdn.myanimelist.net/images/anime/1/1.jpg'],
    ['another host', 'https://images.example/images/anime/1/1.jpg'],
    ['a look-alike host', 'https://cdn.myanimelist.net.evil.example/images/anime/1/1.jpg'],
    ['userinfo', 'https://cdn.myanimelist.net@evil.example/x.jpg'],
    ['a port', 'https://cdn.myanimelist.net:8443/images/anime/1/1.jpg'],
    ['an uppercase host', 'https://CDN.myanimelist.net/images/anime/1/1.jpg'],
    ['a backslash', 'https://cdn.myanimelist.net\\evil.example/x.jpg'],
    ['whitespace', 'https://cdn.myanimelist.net/images/anime/1/1 .jpg'],
    ['a fragment', 'https://cdn.myanimelist.net/images/anime/1/1.jpg#x'],
    ['no path', 'https://cdn.myanimelist.net'],
    ['a query without a path', 'https://cdn.myanimelist.net?x=1'],
    ['a second query mark', 'https://cdn.myanimelist.net/1.jpg?a=1?b=2'],
    ['a control character', 'https://cdn.myanimelist.net/images/\u0000.jpg'],
    ['a non-ascii character', 'https://cdn.myanimelist.net/images/é.jpg'],
  ])('rejects %s', (_case, url) => {
    expect(toAllowedImageUrl(url, HOSTS)).toBeNull();
  });

  it('keeps a url of the maximum length and rejects a longer one', () => {
    const longest = urlOfLength(IMAGE_URL_MAX_LENGTH);
    expect(longest).toHaveLength(IMAGE_URL_MAX_LENGTH);
    expect(toAllowedImageUrl(longest, HOSTS)).toBe(longest);
    expect(toAllowedImageUrl(urlOfLength(IMAGE_URL_MAX_LENGTH + 1), HOSTS)).toBeNull();
  });

  it.each([null, undefined, 42, { url: `${ORIGIN}/1.jpg` }, [`${ORIGIN}/1.jpg`]])(
    'rejects the non-string %p',
    (value) => {
      expect(toAllowedImageUrl(value, HOSTS)).toBeNull();
    },
  );

  it('rejects every url when no host is allowed', () => {
    expect(toAllowedImageUrl(`${ORIGIN}/images/anime/1/1.jpg`, [])).toBeNull();
  });
});
