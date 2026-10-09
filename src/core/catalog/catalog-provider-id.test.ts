import { describe, expect, it } from '@jest/globals';

import { CATALOG_PROVIDER_IDS } from './catalog-provider-id';

describe('CATALOG_PROVIDER_IDS', () => {
  it('lists jikan as the only provider', () => {
    expect(CATALOG_PROVIDER_IDS).toStrictEqual(['jikan']);
  });
});
