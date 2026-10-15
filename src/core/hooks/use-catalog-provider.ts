import { use } from 'react';

import type { CatalogProvider } from '../catalog/catalog-provider';
import { CatalogContext, MISSING_CATALOG_PROVIDER_MESSAGE } from './catalog-context';

/** the catalog provider of the nearest CatalogContextProvider; throws outside of it */
export const useCatalogProvider = (): CatalogProvider => {
  const provider = use(CatalogContext);
  if (provider === null) {
    throw new Error(MISSING_CATALOG_PROVIDER_MESSAGE);
  }
  return provider;
};
