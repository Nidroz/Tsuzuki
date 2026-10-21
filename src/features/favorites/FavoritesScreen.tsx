import { useTranslation } from '@core/i18n/index';
import { LibraryEntriesScreen } from '@features/library/LibraryEntriesScreen';

/**
 * the favorites screen (FR-15): the library restricted to its favorites, with the same filters,
 * groups and rows as the library screen (LibraryEntriesScreen). testIDs: `favorites-screen`,
 * `favorites-loading`, `favorites-error`, `favorites-empty`, `favorites-list`,
 * `favorites-filters`. without a favorite, it says how to add one
 */
export function FavoritesScreen() {
  const { t } = useTranslation();

  return (
    <LibraryEntriesScreen
      favoritesOnly
      testID="favorites"
      empty={{
        title: t('favorites.empty.title'),
        message: t('favorites.empty.message'),
        action: t('favorites.empty.action'),
      }}
    />
  );
}
