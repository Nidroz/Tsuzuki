import type { ReactNode } from 'react';

import type { CatalogProvider } from '../catalog/catalog-provider';
import { CatalogContext } from './catalog-context';

export interface CatalogContextProviderProps {
  /** pass a stable object (module level): a new one re-renders every consumer */
  provider: CatalogProvider;
  children: ReactNode;
}

/** gives the tree the catalog provider; hooks read it with useCatalogProvider */
export function CatalogContextProvider({ provider, children }: CatalogContextProviderProps) {
  return <CatalogContext value={provider}>{children}</CatalogContext>;
}
