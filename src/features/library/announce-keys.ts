// the announcement keys of the library states several mounted views show at once: the library
// and favorites tabs stay mounted together, and the detail screen opens above them. views showing
// the same state pass the same key, so it is announced once (useAnnouncement)

/** a failed guest merge: the ErrorState of both tabs and the InlineError of the detail */
export const GUEST_MERGE_FAILED_ANNOUNCE_KEY = 'library-guest-merge-failed';

/** the notice of the stuck writes, in both tabs */
export const LIBRARY_SYNC_NOTICE_ANNOUNCE_KEY = 'library-sync-notice';

/** the feedback of a Try again or a Discard of the stuck writes, in both tabs */
export const LIBRARY_SYNC_FEEDBACK_ANNOUNCE_KEY = 'library-sync-feedback';
