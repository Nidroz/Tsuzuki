import { describe, expect, it, jest } from '@jest/globals';
import { isHiddenFromAccessibility, screen, userEvent } from '@testing-library/react-native';
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
const ERROR_REGION_TEST_ID = `${TEST_ID}-error-region`;
const FOCUS_BORDER = 'focus:border-focus';

const field = () => screen.getByLabelText(LABEL);
// the visible label, found in the whole tree: screen readers do not reach it
const visibleLabel = () => screen.getByText(LABEL, { includeHiddenElements: true });
const errorRegion = () => screen.getByTestId(ERROR_REGION_TEST_ID);

interface HostNode {
  readonly props: Readonly<Record<string, unknown>>;
  readonly parent: HostNode | null;
}

// the element and its ancestors, from the element up to the root
const selfAndAncestors = (element: HostNode): HostNode[] => {
  const chain: HostNode[] = [];
  for (let current: HostNode | null = element; current !== null; current = current.parent) {
    chain.push(current);
  }
  return chain;
};

// hidden for voiceover (aria-hidden or accessibilityElementsHidden) and for talkback (aria-hidden or
// importantForAccessibility="no-hide-descendants"), on the element or one of its ancestors
const hiddenOnBothPlatforms = (element: HostNode) => {
  const props = selfAndAncestors(element).map((node) => node.props);
  const ariaHidden = props.some((node) => node['aria-hidden'] === true);
  return {
    ios: ariaHidden || props.some((node) => node.accessibilityElementsHidden === true),
    android:
      ariaHidden || props.some((node) => node.importantForAccessibility === 'no-hide-descendants'),
  };
};

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

    expect(visibleLabel()).toBeOnTheScreen();
    expect(field()).toBe(screen.getByTestId(TEST_ID));
    expect(field()).toHaveAccessibleName(LABEL);
  });

  // the field already carries the label: screen readers would read it twice
  it('hides its visible label from screen readers on both platforms', async () => {
    await renderWithTheme(
      <Input label={LABEL} value="" onChangeText={jest.fn()} testID={TEST_ID} />,
    );

    expect(hiddenOnBothPlatforms(visibleLabel())).toStrictEqual({ ios: true, android: true });
    expect(isHiddenFromAccessibility(visibleLabel())).toBe(true);
    expect(screen.queryByText(LABEL)).not.toBeOnTheScreen();
    expect(screen.getAllByLabelText(LABEL)).toStrictEqual([field()]);
    expect(isHiddenFromAccessibility(field())).toBe(false);
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
    expect(errorRegion()).toBeEmptyElement();
    expect(classesOf(field())).toContain('border-border');
    expect(classesOf(field())).toContain(FOCUS_BORDER);
  });

  // talkback reads a live region when its content changes, not when it mounts with its content
  it('mounts its polite live region before any error and keeps it when the error clears', async () => {
    const { rerender } = await renderWithTheme(
      <Input label={LABEL} value="" onChangeText={jest.fn()} testID={TEST_ID} />,
    );

    const region = errorRegion();

    expect(region).toHaveProp('accessibilityLiveRegion', 'polite');
    expect(region).toBeEmptyElement();

    await rerender(
      <Input label={LABEL} value="" onChangeText={jest.fn()} error={ERROR} testID={TEST_ID} />,
    );

    expect(errorRegion()).toBe(region);
    expect(region).toContainElement(screen.getByTestId(ERROR_TEST_ID));
    expect(region).toHaveTextContent(ERROR, { exact: true });

    await rerender(<Input label={LABEL} value="x" onChangeText={jest.fn()} testID={TEST_ID} />);

    expect(errorRegion()).toBe(region);
    expect(region).toHaveProp('accessibilityLiveRegion', 'polite');
    expect(region).toBeEmptyElement();
    expect(screen.queryByTestId(ERROR_TEST_ID)).not.toBeOnTheScreen();
  });

  it('shows the error in the danger tone, in a polite live region, with a danger border', async () => {
    await renderWithTheme(
      <Input label={LABEL} value="" onChangeText={jest.fn()} error={ERROR} testID={TEST_ID} />,
    );

    const message = screen.getByTestId(ERROR_TEST_ID);

    expect(message).toHaveTextContent(ERROR);
    expect(classesOf(message)).toEqual(expect.arrayContaining(['text-caption', 'text-danger']));
    expect(errorRegion()).toContainElement(message);
    expect(errorRegion()).toHaveProp('accessibilityLiveRegion', 'polite');
    expect(classesOf(field())).toContain('border-danger');
    expect(classesOf(field())).not.toContain('border-border');
  });

  // the focus border would hide the danger border while the field is focused
  it('drops the focus border while an error is shown', async () => {
    const { rerender } = await renderWithTheme(
      <Input label={LABEL} value="" onChangeText={jest.fn()} error={ERROR} />,
    );

    expect(classesOf(field())).toContain('border-danger');
    expect(classesOf(field())).not.toContain(FOCUS_BORDER);

    await rerender(<Input label={LABEL} value="" onChangeText={jest.fn()} />);

    expect(classesOf(field())).toContain(FOCUS_BORDER);
    expect(classesOf(field())).not.toContain('border-danger');
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
        FOCUS_BORDER,
      ]),
    );
  });
});
