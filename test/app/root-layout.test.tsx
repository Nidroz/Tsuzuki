import { describe, expect, it } from '@jest/globals';
import { Spinner } from '@ui/index';
import { screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import RootLayout from '../../app/_layout';
import { renderRouterAsync } from '../mobile/render-router';

const ROOT_PATHNAME = '/';
const STUB_TEXT = 'stub index route';
// the native stack header is a native view: in tests it only shows up as this react-native-screens
// host component, whose `hidden` prop mirrors the headerShown option (its title is not rendered text)
const NATIVE_HEADER_HOST = 'RNSScreenStackHeaderConfig';

// the index route is a stub: this test covers the layout alone
function StubIndexScreen() {
  return <Text>{STUB_TEXT}</Text>;
}

const SPINNER_LABEL = 'stub loading';

// a themed primitive: it reads the palette from ThemeProvider and throws outside of it
function ThemedIndexScreen() {
  return <Spinner accessibilityLabel={SPINNER_LABEL} />;
}

const renderLayout = () => renderRouterAsync({ _layout: RootLayout, index: StubIndexScreen });

describe('root layout', () => {
  it('renders the index route of the stack at the root pathname', async () => {
    const router = await renderLayout();

    expect(router.getPathname()).toBe(ROOT_PATHNAME);
    expect(screen.getByText(STUB_TEXT)).toBeOnTheScreen();
  });

  it('hides the stack header so no untranslated route title is shown', async () => {
    await renderLayout();

    const headers = screen.container.queryAll(({ type }) => type === NATIVE_HEADER_HOST);

    expect(headers).toHaveLength(1);
    expect(headers[0]?.props).toMatchObject({ hidden: true });
  });

  it('wraps the routes in the theme provider', async () => {
    await renderRouterAsync({ _layout: RootLayout, index: ThemedIndexScreen });

    expect(screen.getByRole('progressbar', { name: SPINNER_LABEL })).toBeOnTheScreen();
  });
});
