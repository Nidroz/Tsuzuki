import Ionicons from '@expo/vector-icons/Ionicons';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent, within } from '@testing-library/react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { palettes } from '../theme/colors';
import { ICON_SIZE } from '../theme/sizes';
import { IconButton, type IconName } from './IconButton';

const LABEL = 'Add to favorites';
const HINT = 'Adds the title to your favorites';
const TEST_ID = 'icon-button';

// the icons by meaning and the ionicons glyph each one draws
const GLYPHS: Record<IconName, keyof typeof Ionicons.glyphMap> = {
  add: 'add',
  remove: 'remove',
  favorite: 'heart',
  'favorite-outline': 'heart-outline',
  search: 'search',
  close: 'close',
  'chevron-back': 'chevron-back',
  'chevron-forward': 'chevron-forward',
  settings: 'settings-outline',
  refresh: 'refresh',
};

// ionicons draws its glyph as the text of a host Text, in its own font
const glyphText = () => within(screen.getByTestId(TEST_ID)).getByText(/./u);
const glyphStyle = () =>
  Object.assign({}, ...[glyphText().props.style as unknown].flat(Infinity)) as Record<
    string,
    unknown
  >;

describe('IconButton', () => {
  it.each(Object.entries(GLYPHS) as [IconName, keyof typeof Ionicons.glyphMap][])(
    'draws the %s icon with the ionicons %s glyph',
    async (icon, glyph) => {
      await renderWithTheme(
        <IconButton icon={icon} accessibilityLabel={LABEL} onPress={jest.fn()} testID={TEST_ID} />,
      );

      expect(glyphText()).toHaveTextContent(String.fromCodePoint(Number(Ionicons.glyphMap[glyph])));
    },
  );

  it('is announced as a button with its accessibility label', async () => {
    await renderWithTheme(<IconButton icon="add" accessibilityLabel={LABEL} onPress={jest.fn()} />);

    expect(screen.getByRole('button', { name: LABEL })).toBeEnabled();
  });

  it('draws the glyph at the icon size in the text color', async () => {
    await renderWithTheme(
      <IconButton icon="add" accessibilityLabel={LABEL} onPress={jest.fn()} testID={TEST_ID} />,
    );

    expect(glyphStyle()).toMatchObject({ fontSize: ICON_SIZE, color: palettes.light.text });
  });

  it('calls onPress when pressed', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(<IconButton icon="add" accessibilityLabel={LABEL} onPress={onPress} />);

    await user.press(screen.getByRole('button', { name: LABEL }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is disabled, dimmed and ignores presses when disabled', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(
      <IconButton icon="add" accessibilityLabel={LABEL} onPress={onPress} disabled />,
    );

    const button = screen.getByRole('button', { name: LABEL });
    await user.press(button);

    expect(onPress).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
    expect(classesOf(button)).toContain('opacity-disabled');
  });

  it('is announced as selected and drawn in the primary color when selected', async () => {
    await renderWithTheme(
      <IconButton
        icon="favorite"
        accessibilityLabel={LABEL}
        onPress={jest.fn()}
        selected
        testID={TEST_ID}
      />,
    );

    expect(screen.getByRole('button', { name: LABEL, selected: true })).toBeSelected();
    expect(glyphStyle()).toMatchObject({ color: palettes.light.primary });
  });

  it('is announced as not selected when selected is false', async () => {
    await renderWithTheme(
      <IconButton
        icon="favorite-outline"
        accessibilityLabel={LABEL}
        onPress={jest.fn()}
        selected={false}
        testID={TEST_ID}
      />,
    );

    expect(screen.getByRole('button', { name: LABEL })).toHaveProp('accessibilityState', {
      disabled: false,
      selected: false,
    });
    expect(glyphStyle()).toMatchObject({ color: palettes.light.text });
  });

  it('has no selected state when it is not a toggle', async () => {
    await renderWithTheme(<IconButton icon="add" accessibilityLabel={LABEL} onPress={jest.fn()} />);

    expect(screen.getByRole('button', { name: LABEL })).toHaveProp('accessibilityState', {
      disabled: false,
    });
  });

  it('has a full touch target, round, with the pressed feedback', async () => {
    await renderWithTheme(
      <IconButton icon="add" accessibilityLabel={LABEL} onPress={jest.fn()} testID={TEST_ID} />,
    );

    expect(classesOf(screen.getByTestId(TEST_ID))).toStrictEqual([
      'min-h-touch',
      'min-w-touch',
      'items-center',
      'justify-center',
      'rounded-full',
      'active:opacity-pressed',
    ]);
  });

  it('passes the accessibility hint, none by default', async () => {
    const { rerender } = await renderWithTheme(
      <IconButton icon="add" accessibilityLabel={LABEL} onPress={jest.fn()} testID={TEST_ID} />,
    );

    expect(screen.getByTestId(TEST_ID).props).not.toHaveProperty('accessibilityHint');

    await rerender(
      <IconButton
        icon="add"
        accessibilityLabel={LABEL}
        accessibilityHint={HINT}
        onPress={jest.fn()}
        testID={TEST_ID}
      />,
    );

    expect(screen.getByHintText(HINT)).toBe(screen.getByRole('button', { name: LABEL }));
  });

  it('requires an accessibility label and a known icon name', async () => {
    // @ts-expect-error(F-05): an icon-only button needs a translated accessibility label
    await renderWithTheme(<IconButton icon="add" onPress={jest.fn()} testID={TEST_ID} />);
    // @ts-expect-error(F-05): screens name icons by meaning, never by icon set glyph
    const glyphName: IconName = 'heart';

    expect(screen.getByTestId(TEST_ID)).toBeOnTheScreen();
    expect(Object.keys(GLYPHS)).not.toContain(glyphName);
  });
});
