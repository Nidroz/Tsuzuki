import { describe, expect, it } from '@jest/globals';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createFakeCatalogProvider } from '../catalog/__fixtures__/fake-catalog-provider';
import { MISSING_CATALOG_PROVIDER_MESSAGE } from './catalog-context';
import { CatalogContextProvider } from './CatalogContextProvider';
import { useCatalogProvider } from './use-catalog-provider';

describe('CatalogContextProvider', () => {
  it('gives useCatalogProvider the given provider itself', () => {
    const provider = createFakeCatalogProvider();
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <CatalogContextProvider provider={provider}>{children}</CatalogContextProvider>
    );

    const { result } = renderHook(useCatalogProvider, { wrapper });

    expect(result.current).toBe(provider);
  });

  it('gives the nearest provider to a nested tree', () => {
    const outer = createFakeCatalogProvider();
    const inner = createFakeCatalogProvider();
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <CatalogContextProvider provider={outer}>
        <CatalogContextProvider provider={inner}>{children}</CatalogContextProvider>
      </CatalogContextProvider>
    );

    const { result } = renderHook(useCatalogProvider, { wrapper });

    expect(result.current).toBe(inner);
  });

  it('makes useCatalogProvider throw outside of it', () => {
    expect(() => renderHook(useCatalogProvider)).toThrow(MISSING_CATALOG_PROVIDER_MESSAGE);
  });
});
