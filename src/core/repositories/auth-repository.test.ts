import { describe, expect, it } from '@jest/globals';

import { noCaptcha } from './auth-repository';

describe('noCaptcha', () => {
  it('gives no token for any action', async () => {
    await expect(noCaptcha.getToken('sign-in')).resolves.toBeNull();
  });
});
