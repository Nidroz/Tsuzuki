import Ionicons from '@expo/vector-icons/Ionicons';
import { describe, expect, it } from '@jest/globals';
import { screen, within } from '@testing-library/react-native';
import { View } from 'react-native';

import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { palettes } from '../theme/colors';
import { ICON_SIZE } from '../theme/sizes';
import { TabBarIcon, type TabIconName } from './TabBarIcon';

const WRAPPER_TEST_ID = 'tab-icon';

type Glyph = keyof typeof Ionicons.glyphMap;

// the tabs and the ionicons glyphs each one draws: [focused, unfocused]
const TAB_GLYPHS: Record<TabIconName, readonly [Glyph, Glyph]> = {
  discover: ['compass', 'compass-outline'],
  search: ['search', 'search-outline'],
  library: ['library', 'library-outline'],
  favorites: ['heart', 'heart-outline'],
  settings: ['settings', 'settings-outline'],
};

const charOf = (glyph: Glyph) => String.fromCodePoint(Number(Ionicons.glyphMap[glyph]));

const renderIcon = (icon: TabIconName, focused: boolean) =>
  renderWithTheme(
    <View testID={WRAPPER_TEST_ID}>
      <TabBarIcon icon={icon} focused={focused} />
    </View>,
  );

// ionicons draws its glyph as the text of a host Text; the icon is hidden from accessibility, so
// the query includes hidden elements
const glyphText = () =>
  within(screen.getByTestId(WRAPPER_TEST_ID)).getByText(/./u, { includeHiddenElements: true });
const glyphStyle = () =>
  Object.assign({}, ...[glyphText().props.style as unknown].flat(Infinity)) as Record<
    string,
    unknown
  >;

describe('TabBarIcon', () => {
  it.each(Object.entries(TAB_GLYPHS) as [TabIconName, readonly [Glyph, Glyph]][])(
    'draws the %s tab with its filled glyph when focused and its outline otherwise',
    async (icon, [focusedGlyph, unfocusedGlyph]) => {
      const { rerender } = await renderIcon(icon, true);

      expect(glyphText()).toHaveTextContent(charOf(focusedGlyph));

      await rerender(
        <View testID={WRAPPER_TEST_ID}>
          <TabBarIcon icon={icon} focused={false} />
        </View>,
      );

      expect(glyphText()).toHaveTextContent(charOf(unfocusedGlyph));
    },
  );

  it('is drawn at the icon size in the primary color when focused', async () => {
    await renderIcon('discover', true);

    expect(glyphStyle()).toMatchObject({ fontSize: ICON_SIZE, color: palettes.light.primary });
  });

  it('is drawn in the muted text color when not focused', async () => {
    await renderIcon('discover', false);

    expect(glyphStyle()).toMatchObject({ fontSize: ICON_SIZE, color: palettes.light.textMuted });
  });

  it('is hidden from screen readers, the tab button carrying the label', async () => {
    await renderIcon('library', true);

    expect(glyphText()).not.toBeVisible();
    expect(screen.queryByText(/./u)).not.toBeOnTheScreen();
    expect(glyphText()).toHaveProp('accessibilityElementsHidden', true);
    expect(glyphText()).toHaveProp('importantForAccessibility', 'no-hide-descendants');
  });
});
