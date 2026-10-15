/**
 * the recent searches of FR-02, kept on the device only, newest first. synchronous, so the search
 * screen shows them on its first frame. entries are prepared queries (prepareSearchQuery,
 * src/core/domain/search-query.ts) and the list follows the rules of
 * src/core/domain/recent-searches.ts. personal data: never logged or reported, purged on sign out
 * (FR-25).
 */
export interface RecentSearchesRepository {
  /**
   * the stored list. stored content is untrusted: invalid content gives an empty list, invalid
   * entries are dropped and the list is capped, so the result always follows the domain rules.
   */
  load(): readonly string[];
  /** replaces the stored list; the caller passes a list built by the domain rules. */
  save(searches: readonly string[]): void;
  /** removes the stored list. */
  clear(): void;
}
