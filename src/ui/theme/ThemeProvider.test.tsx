import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { useTheme as useNavigationTheme } from 'expo-router';
import type * as Nativewind from 'nativewind';
import { Text } from 'react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { type ColorScheme, palettes } from './colors';
import { paletteVariables } from './css-variables';
import { navigationThemeFor } from './navigation-theme';
import { useThemeColors } from './theme-context';
import { type ColorSchemePreference, ThemeProvider } from './ThemeProvider';

// the factories run when the provider is imported, before these mocks are initialized: they call
// them lazily. the device scheme reaches ThemeProvider through nativewind's useColorScheme, and the preference
// leaves through colorScheme.set (which drives Appearance). vars() is replaced by the identity so
// the variables the provider applies can be read back from the root view's style
const mockDeviceScheme = jest.fn<() => ColorScheme | undefined>();
const mockSetColorScheme = jest.fn<(preference: ColorSchemePreference) => void>();
const mockStatusBar = jest.fn<(props: { style: string }) => null>();
const mockSetBackgroundColor = jest.fn<(color: string) => Promise<void>>();

jest.mock('nativewind', () => {
  const actual = jest.requireActual<typeof Nativewind>('nativewind');
  return {
    ...actual,
    useColorScheme: () => ({ ...actual.useColorScheme(), colorScheme: mockDeviceScheme() }),
    colorScheme: {
      ...actual.colorScheme,
      set: (preference: ColorSchemePreference) => {
        mockSetColorScheme(preference);
      },
    },
    vars: (variables: Record<string, string>) => variables,
  };
});

jest.mock('expo-status-bar', () => ({
  StatusBar: (props: { style: string }) => mockStatusBar(props),
}));

jest.mock('expo-system-ui', () => ({
  setBackgroundColorAsync: (color: string) => mockSetBackgroundColor(color),
}));

const CHILD_TEXT = 'themed content';
const COLORS_TEST_ID = 'colors';
const NAVIGATION_TEST_ID = 'navigation-theme';

// shows the palette the provider hands to its tree
function PaletteProbe() {
  const colors = useThemeColors();
  return <Text testID={COLORS_TEST_ID}>{colors.background}</Text>;
}

// shows the navigation theme navigators read (react navigation's useTheme, through expo-router)
function NavigationThemeProbe() {
  const theme = useNavigationTheme();
  return <Text testID={NAVIGATION_TEST_ID}>{JSON.stringify(theme)}</Text>;
}

const renderProvider = (preference: ColorSchemePreference) =>
  render(
    <ThemeProvider preference={preference}>
      <Text>{CHILD_TEXT}</Text>
      <PaletteProbe />
      <NavigationThemeProbe />
    </ThemeProvider>,
  );

// the root view that carries the palette variables
const themeRoot = () => {
  const root = screen.getByText(CHILD_TEXT).parent;
  if (root === null) {
    throw new Error('the child has no parent view');
  }
  return root;
};

const lastStatusBarStyle = () => mockStatusBar.mock.calls.at(-1)?.[0].style;

const navigationTheme = () => screen.getByTestId(NAVIGATION_TEST_ID).props.children as string;

const rootBackgrounds = () => mockSetBackgroundColor.mock.calls.map(([color]) => color);

// restoreMocks restores spies only: these module mocks are reset by hand so no call or return
// value leaks from one test to the next
beforeEach(() => {
  mockDeviceScheme.mockReset();
  mockSetColorScheme.mockReset();
  mockStatusBar.mockReset();
  mockSetBackgroundColor.mockReset();
  mockDeviceScheme.mockReturnValue('light');
  mockStatusBar.mockReturnValue(null);
  mockSetBackgroundColor.mockResolvedValue(undefined);
});

describe('ThemeProvider', () => {
  it('renders its children in a view that fills the screen', async () => {
    await renderProvider('light');

    expect(screen.getByText(CHILD_TEXT)).toBeOnTheScreen();
    expect(classesOf(themeRoot())).toStrictEqual(['flex-1']);
  });

  describe.each<[ColorSchemePreference, ColorScheme, ColorScheme, string]>([
    ['light', 'dark', 'light', 'dark'],
    ['dark', 'light', 'dark', 'light'],
    ['system', 'light', 'light', 'dark'],
    ['system', 'dark', 'dark', 'light'],
  ])('with preference %s on a %s device', (preference, device, scheme, statusBarStyle) => {
    it(`uses the ${scheme} palette`, async () => {
      mockDeviceScheme.mockReturnValue(device);

      await renderProvider(preference);

      expect(screen.getByTestId(COLORS_TEST_ID)).toHaveTextContent(palettes[scheme].background);
    });

    it(`applies the ${scheme} palette variables to the tree`, async () => {
      mockDeviceScheme.mockReturnValue(device);

      await renderProvider(preference);

      expect(themeRoot()).toHaveProp('style', paletteVariables(palettes[scheme]));
    });

    it(`draws ${statusBarStyle} status bar content`, async () => {
      mockDeviceScheme.mockReturnValue(device);

      await renderProvider(preference);

      expect(lastStatusBarStyle()).toBe(statusBarStyle);
    });

    it(`gives navigators the ${scheme} navigation theme`, async () => {
      mockDeviceScheme.mockReturnValue(device);

      await renderProvider(preference);

      expect(JSON.parse(navigationTheme())).toStrictEqual(navigationThemeFor(scheme));
    });

    it(`paints the native root view with the ${scheme} background`, async () => {
      mockDeviceScheme.mockReturnValue(device);

      await renderProvider(preference);

      expect(rootBackgrounds()).toStrictEqual([palettes[scheme].background]);
    });

    it('hands the preference to nativewind, which sets the native appearance', async () => {
      mockDeviceScheme.mockReturnValue(device);

      await renderProvider(preference);

      expect(mockSetColorScheme).toHaveBeenCalledWith(preference);
    });
  });

  it('falls back to the light palette when the device scheme is unknown', async () => {
    mockDeviceScheme.mockReturnValue(undefined);

    await renderProvider('system');

    expect(screen.getByTestId(COLORS_TEST_ID)).toHaveTextContent(palettes.light.background);
    expect(lastStatusBarStyle()).toBe('dark');
  });

  it('switches palette and appearance when the preference changes', async () => {
    mockDeviceScheme.mockReturnValue('light');
    const { rerender } = await renderProvider('system');

    expect(mockSetColorScheme).toHaveBeenLastCalledWith('system');

    await rerender(
      <ThemeProvider preference="dark">
        <Text>{CHILD_TEXT}</Text>
        <PaletteProbe />
        <NavigationThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId(COLORS_TEST_ID)).toHaveTextContent(palettes.dark.background);
    expect(themeRoot()).toHaveProp('style', paletteVariables(palettes.dark));
    expect(lastStatusBarStyle()).toBe('light');
    expect(mockSetColorScheme).toHaveBeenLastCalledWith('dark');
    expect(JSON.parse(navigationTheme())).toStrictEqual(navigationThemeFor('dark'));
    expect(rootBackgrounds()).toStrictEqual([palettes.light.background, palettes.dark.background]);
  });

  it('follows the device scheme while the preference is system', async () => {
    mockDeviceScheme.mockReturnValue('light');
    const { rerender } = await renderProvider('system');

    mockDeviceScheme.mockReturnValue('dark');
    await rerender(
      <ThemeProvider preference="system">
        <Text>{CHILD_TEXT}</Text>
        <PaletteProbe />
        <NavigationThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId(COLORS_TEST_ID)).toHaveTextContent(palettes.dark.background);
    expect(JSON.parse(navigationTheme())).toStrictEqual(navigationThemeFor('dark'));
    expect(rootBackgrounds()).toStrictEqual([palettes.light.background, palettes.dark.background]);
  });

  it('paints the root view again only when the scheme changes', async () => {
    mockDeviceScheme.mockReturnValue('dark');
    const { rerender } = await renderProvider('system');

    // system on a dark device and an explicit dark preference resolve to the same scheme
    await rerender(
      <ThemeProvider preference="dark">
        <Text>{CHILD_TEXT}</Text>
      </ThemeProvider>,
    );

    expect(rootBackgrounds()).toStrictEqual([palettes.dark.background]);
  });

  it('reports a failure to set the root view background to onError', async () => {
    const failure = new Error('no root view');
    mockSetBackgroundColor.mockRejectedValue(failure);
    const onError = jest.fn<(error: unknown) => void>();

    await render(
      <ThemeProvider preference="dark" onError={onError}>
        <Text>{CHILD_TEXT}</Text>
      </ThemeProvider>,
    );
    // lets the rejection handler run
    await act(async () => {
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('drops a failure to set the root view background without onError', async () => {
    mockSetBackgroundColor.mockRejectedValue(new Error('no root view'));

    await renderProvider('dark');
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(CHILD_TEXT)).toBeOnTheScreen();
  });

  it('sets the appearance once per preference, not on every render', async () => {
    const { rerender } = await renderProvider('dark');
    await rerender(
      <ThemeProvider preference="dark">
        <Text>{CHILD_TEXT}</Text>
      </ThemeProvider>,
    );

    expect(mockSetColorScheme).toHaveBeenCalledTimes(1);
  });
});
