import { describe, expect, it } from '@jest/globals';

import {
  INCOMING_LINK_MAX_LENGTH,
  INCOMING_LINK_MAX_PERCENT_ESCAPES,
  isIncomingLinkWithinLimits,
} from './incoming-link';

const MEDIA_LINK = 'tsuzuki://media/mal/anime/52991';
const AUTH_ERROR_LINK =
  'tsuzuki://auth/callback?sb_flow_id=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee&error=access_denied' +
  '&error_code=otp_expired&error_description=Email%20link%20is%20invalid%20or%20has%20expired';

// a link of exactly `length` code units: the media link padded with a query value
const linkOfLength = (length: number) => {
  const prefix = `${MEDIA_LINK}?pad=`;
  return prefix + 'a'.repeat(length - prefix.length);
};

// a media link whose query holds `count` percent-encoded bytes
const linkWithEscapes = (count: number) => `${MEDIA_LINK}?q=${'%41'.repeat(count)}`;

describe('isIncomingLinkWithinLimits', () => {
  it.each([MEDIA_LINK, AUTH_ERROR_LINK, '/media/mal/manga/2'])('accepts the app link %s', (url) => {
    expect(isIncomingLinkWithinLimits(url)).toBe(true);
  });

  it('accepts a link of exactly the maximum length and rejects one unit more', () => {
    expect(linkOfLength(INCOMING_LINK_MAX_LENGTH)).toHaveLength(INCOMING_LINK_MAX_LENGTH);
    expect(isIncomingLinkWithinLimits(linkOfLength(INCOMING_LINK_MAX_LENGTH))).toBe(true);
    expect(isIncomingLinkWithinLimits(linkOfLength(INCOMING_LINK_MAX_LENGTH + 1))).toBe(false);
  });

  it('accepts exactly the maximum count of percent escapes and rejects one more', () => {
    expect(isIncomingLinkWithinLimits(linkWithEscapes(INCOMING_LINK_MAX_PERCENT_ESCAPES))).toBe(
      true,
    );
    expect(isIncomingLinkWithinLimits(linkWithEscapes(INCOMING_LINK_MAX_PERCENT_ESCAPES + 1))).toBe(
      false,
    );
  });

  it('counts lowercase hex escapes and ignores a percent sign without two hex digits', () => {
    const lowercase = `${MEDIA_LINK}?q=${'%c3%a9'.repeat(INCOMING_LINK_MAX_PERCENT_ESCAPES)}`;
    const notEscapes = `${MEDIA_LINK}?q=${'%zz%4'.repeat(INCOMING_LINK_MAX_PERCENT_ESCAPES)}`;

    expect(isIncomingLinkWithinLimits(lowercase)).toBe(false);
    expect(isIncomingLinkWithinLimits(notEscapes)).toBe(true);
  });
});
