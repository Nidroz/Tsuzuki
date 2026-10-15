// the recent searches of FR-02 (SPEC.md): prepared queries, newest first, without duplicates
// ignoring case, at most RECENT_SEARCHES_MAX. pure rules: storage is a repository's job

/** the most recent searches kept (FR-02). */
export const RECENT_SEARCHES_MAX = 10;

/**
 * `list` (newest first) following the rules: of the entries equal ignoring case, only the first
 * (newest) one is kept, with its casing, then the list is capped at RECENT_SEARCHES_MAX.
 * case folding uses toLowerCase, which does not depend on the device locale.
 */
export const normalizeRecentSearches = (list: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of list) {
    if (result.length >= RECENT_SEARCHES_MAX) {
      break;
    }
    const folded = entry.toLowerCase();
    if (!seen.has(folded)) {
      seen.add(folded);
      result.push(entry);
    }
  }
  return result;
};

/**
 * `list` with the prepared `query` recorded as the newest search: a search already in the list,
 * ignoring case, moves to the top with the casing of `query`.
 */
export const addRecentSearch = (list: readonly string[], query: string): readonly string[] =>
  normalizeRecentSearches([query, ...list]);
