import type { ComponentType } from 'react';

import NotFoundRoute from '../../app/+not-found';
import TabsLayout from '../../app/(tabs)/_layout';
import FavoritesRoute from '../../app/(tabs)/favorites';
import DiscoverRoute from '../../app/(tabs)/index';
import LibraryRoute from '../../app/(tabs)/library';
import SearchRoute from '../../app/(tabs)/search';
import SettingsRoute from '../../app/(tabs)/settings';
import RootLayout, { unstable_settings } from '../../app/_layout';
import MediaDetailRoute from '../../app/media/[kind]/[id]';

/**
 * the in-memory route map of the app, keyed as in app/ without the extension: the real files of
 * every route, the root layout included. a test replaces a route with a stub by spreading this map.
 * a component stands for a module with only a default export: the root layout is given as its
 * module, with the settings that put the tabs below a cold deep link
 */
export const APP_ROUTES = {
  _layout: { default: RootLayout, unstable_settings },
  '(tabs)/_layout': TabsLayout,
  '(tabs)/index': DiscoverRoute,
  '(tabs)/search': SearchRoute,
  '(tabs)/library': LibraryRoute,
  '(tabs)/favorites': FavoritesRoute,
  '(tabs)/settings': SettingsRoute,
  'media/[kind]/[id]': MediaDetailRoute,
  '+not-found': NotFoundRoute,
} as const;

/** the app routes with the Discover route (the path /) replaced */
export const appRoutesWithDiscover = (discover: ComponentType) => ({
  ...APP_ROUTES,
  '(tabs)/index': discover,
});
