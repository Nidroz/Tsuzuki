// queries of the native stack headers of a rendered route, for the route tests
import { screen } from 'expo-router/testing-library';

/**
 * the native stack header only shows up as this react-native-screens host component, whose title
 * prop is the header title
 */
export const NATIVE_HEADER_HOST = 'RNSScreenStackHeaderConfig';

const nativeHeaders = () => screen.container.queryAll(({ type }) => type === NATIVE_HEADER_HOST);

/** the titles of every native stack header on the screen, hidden ones included */
export const headerTitles = (): unknown[] =>
  nativeHeaders().map(({ props }) => (props as { title?: unknown }).title);

/**
 * the back button props of the visible headers: the route name of the screen below ("(tabs)")
 * must never show as a back title or in the ios back history menu
 */
export const visibleBackButtons = () =>
  nativeHeaders()
    .map(({ props }) => props as Record<string, unknown>)
    .filter(({ hidden }) => hidden !== true)
    .map(({ backTitle, backButtonDisplayMode, backTitleVisible, disableBackButtonMenu }) => ({
      backTitle,
      minimal: backButtonDisplayMode === 'minimal' || backTitleVisible === false,
      disableBackButtonMenu,
    }));
