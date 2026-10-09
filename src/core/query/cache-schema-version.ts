/**
 * version of the persisted query data shapes, part of the cache buster (ADR-0005, ADR-0012).
 * bump it when the shape of a persisted query's data changes: an OTA update keeps the app
 * version, so the app version alone would restore data in the old shape.
 */
export const CACHE_SCHEMA_VERSION = 1;
