import { describe, expect, it } from '@jest/globals';

import { APP_SCHEME, AUTH_LINK_PATHS, appLinkUrl } from './app-links';

describe('app links', () => {
  it('builds the auth link urls on the app scheme', () => {
    expect(APP_SCHEME).toBe('tsuzuki');
    expect(appLinkUrl(AUTH_LINK_PATHS.confirmation)).toBe('tsuzuki://auth/callback');
    expect(appLinkUrl(AUTH_LINK_PATHS.passwordReset)).toBe('tsuzuki://auth/reset-password');
  });
});
