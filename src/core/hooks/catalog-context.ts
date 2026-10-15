import { createContext } from 'react';

import type { CatalogProvider } from '../catalog/catalog-provider';

/** the catalog provider chosen by the composition root, set by CatalogContextProvider */
export const CatalogContext = createContext<CatalogProvider | null>(null);

export const MISSING_CATALOG_PROVIDER_MESSAGE =
  'useCatalogProvider is used outside CatalogContextProvider: render the tree inside CatalogContextProvider';
