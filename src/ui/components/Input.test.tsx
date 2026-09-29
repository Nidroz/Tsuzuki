import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { palettes } from '../theme/colors';
import { Input } from './Input';

const LABEL = 'Email';
const ERROR = 'Enter a valid email';
const OTHER_ERROR = 'Email is required';
const PLACEHOLDER = 'you@example.test';
const TEST_ID = 'email';
const ERROR_TEST_ID = `${TEST_ID}-error`;

const field = () => screen.getByLabelText(LABEL);

// the react native jest preset already mocks announceForAccessibility: spyOn hands back that shared
// mock, whose calls survive restoreMocks, so they are cleared here
const spyOnAnnounce = () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  announce.mockClear();
  return announce;
};

describe('Input', () => {
  it('shows its label and labels the field with it', async () => {
    await renderWithTheme(
      <Input label={LABEL} value="" onChangeText={jest.fn()} testID={TEST_ID} />,
    );

    expect(screen.getByText(LABEL)).toBeOnTheScreen();
    expect(field()).toBe(screen.getByTestId(TEST_ID));
    expect(field()).toHaveAccessibleName(LABEL);
  });

  it('shows its value', async () => {
    await renderWithTheme(<Input label={LABEL} value="abc" onChangeText={jest.fn()} />);

    expect(field()).toHaveDisplayValue('abc');
  });

  it('calls onChangeText with the typed text', async () => {
    const onChangeText = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(<Input label={LABEL} value="" onChangeText={onChangeText} />);

    await user.type(field(), 'ab');

    expect(onChangeText).toHaveBeenNthCalledWith(1, 'a');
    expect(onChangeText).toHaveBeenLastCalledWith('b');
  });

  it('calls onSubmitEditing when the keyboard submits', async () => {
    const onSubmitEditing = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(
      <Input label={LABEL} value="" onChangeText={jest.fn()} onSubmitEditing={onSubmitEditing} />,
    );

    await user.type(field(), 'x', { submitEditing: true });

    expect(onSubmitEditing).toHaveBeenCalledTimes(1);
  });

  it('has no error, hint or danger border by default', async () => {
    await renderWithTheme(
      <Input label={LABEL} value="" onChangeText={jest.fn()} testID={TEST_ID} />,
    );

    expect(screen.queryByTestId(ERROR_TEST_ID)).not.toBeOnTheScreen();
    expect(field().props).not.toHaveProperty('accessibilityHint');
    expect(classesOf(field())).toContain('border-border');
    expect(classesOf(field())).not.toContain('border-danger');
  });

  it('treats an empty error as no error', async () => {
    await renderWithTheme(
      <Input label={LABEL} value="" onChangeText={jest.fn()} error="" testID={TEST_ID} />,
    );

    expect(screen.queryByTestId(ERROR_TEST_ID)).not.toBeOnTheScreen();
    expect(classesOf(field())).toContain('border-border');
  });

  it('shows the error in the danger tone, in a polite live region, with a danger border', async () => {
    await renderWithTheme(
      <Input label={LABEL} value="" onChangeText={jest.fn()} error={ERROR} testID={TEST_ID} />,
    );

    const message = screen.getByTestId(ERROR_TEST_ID);

    expect(message).toHaveTextContent(ERROR);
    expect(classesOf(message)).toEqual(expect.arrayContaining(['text-caption', 'text-danger']));
    expect(message.parent).toHaveProp('accessibilityLiveRegion', 'polite');
    expect(classesOf(field())).toContain('border-danger');
    expect(classesOf(field())).not.toContain('border-border');
  });

  it('reads the error again as the field hint', async () => {
    await renderWithTheme(<Input label={LABEL} value="" onChangeText={jest.fn()} error={ERROR} />);

    expect(screen.getByHintText(ERROR)).toBe(field());
  });

  it('shows the error without a testID', async () => {
    await renderWithTheme(<Input label={LABEL} value="" onChangeText={jest.fn()} error={ERROR} />);

    expect(screen.getByText(ERROR)).toBeOnTheScreen();
    expect(screen.getByText(ERROR).props.testID).toBeUndefined();
  });

  describe('on ios', () => {
    it('announces the error when it appears and when it changes', async () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      const announce = spyOnAnnounce();
      const { rerender } = await renderWithTheme(
        <Input label={LABEL} value="" onChangeText={jest.fn()} />,
      );

      expect(announce).not.toHaveBeenCalled();

      await rerender(<Input label={LABEL} value="" onChangeText={jest.fn()} error={ERROR} />);

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenLastCalledWith(ERROR);

      await rerender(<Input label={LABEL} value="x" onChangeText={jest.fn()} error={ERROR} />);

      expect(announce).toHaveBeenCalledTimes(1);

      await rerender(
        <Input label={LABEL} value="x" onChangeText={jest.fn()} error={OTHER_ERROR} />,
      );

      expect(announce).toHaveBeenCalledTimes(2);
      expect(announce).toHaveBeenLastCalledWith(OTHER_ERROR);
    });
  });

  describe('on android', () => {
    it('leaves the announcement to the live region', async () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      const announce = spyOnAnnounce();

      await renderWithTheme(
        <Input label={LABEL} value="" onChangeText={jest.fn()} error={ERROR} />,
      );

      expect(announce).not.toHaveBeenCalled();
    });
  });

  it('uses the default keyboard, no secure entry and the muted placeholder color by default', async () => {
    await renderWithTheme(<Input label={LABEL} value="" onChangeText={jest.fn()} />);

    expect(field()).toHaveProp('keyboardType', 'default');
    expect(field()).toHaveProp('secureTextEntry', false);
    expect(field()).toHaveProp('placeholderTextColor', palettes.light.textMuted);
    for (const prop of ['placeholder', 'returnKeyType', 'onSubmitEditing', 'autoCapitalize']) {
      expect(field().props).not.toHaveProperty(prop);
    }
  });

  it('passes the field options', async () => {
    await renderWithTheme(
      <Input
        label={LABEL}
        value=""
        onChangeText={jest.fn()}
        placeholder={PLACEHOLDER}
        secureTextEntry
        keyboardType="email-address"
        returnKeyType="next"
        autoCapitalize="none"
      />,
    );

    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBe(field());
    expect(field()).toHaveProp('secureTextEntry', true);
    expect(field()).toHaveProp('keyboardType', 'email-address');
    expect(field()).toHaveProp('returnKeyType', 'next');
    expect(field()).toHaveProp('autoCapitalize', 'none');
  });

  it('draws a themed field with a full touch target and a focus border', async () => {
    await renderWithTheme(<Input label={LABEL} value="" onChangeText={jest.fn()} />);

    expect(classesOf(field())).toEqual(
      expect.arrayContaining([
        'min-h-touch',
        'rounded-md',
        'border',
        'bg-surface',
        'text-body',
        'text-text',
        'focus:border-focus',
      ]),
    );
  });
});
