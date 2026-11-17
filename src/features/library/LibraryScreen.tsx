import { useTranslation } from '@core/i18n/index';

import { LibraryEntriesScreen } from './LibraryEntriesScreen';

/**
 * the library screen (FR-14, FR-12, BR-06): every entry of the library (LibraryEntriesScreen).
 * testIDs: `library-screen`, `library-loading`, `library-error`, `library-empty`, `library-list`,
 * `library-filters`, `library-sync`, `library-merge-room`. an empty library says how to add
 * titles; a guest merge refused at the cap shows the account's titles with Remove (R-09)
 */
export function LibraryScreen() {
  const { t } = useTranslation();

  return (
    <LibraryEntriesScreen
      favoritesOnly={false}
      mergeRoom
      testID="library"
      empty={{
        title: t('library.list.empty.title'),
        message: t('library.list.empty.message'),
        action: t('library.list.empty.action'),
      }}
    />
  );
}
