// storage bounds of the database columns the domain validates against, docs/ARCHITECTURE.md §5

/**
 * the largest value of a postgres `integer` column (2^31 - 1): the bound of
 * library_entries.external_id, media_total_units and progress.
 */
export const POSTGRES_INTEGER_MAX = 2_147_483_647;
