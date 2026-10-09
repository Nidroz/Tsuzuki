/** the catalog providers the app can query; `CatalogProvider.id` is one of them. */
export const CATALOG_PROVIDER_IDS = ['jikan'] as const;

export type CatalogProviderId = (typeof CATALOG_PROVIDER_IDS)[number];
