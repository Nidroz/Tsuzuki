import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { palettes } from '../theme/colors';
import { Button, type ButtonVariant } from './Button';

const LABEL = 'Save';
const LOADING_LABEL = 'Saving';
const HINT = 'Saves the entry';
const TEST_ID = 'button';

const VARIANTS: [ButtonVariant, string[], string][] = [
  ['primary', ['bg-primary'], 'text-on-primary'],
  ['secondary', ['border', 'border-border', 'bg-surface-muted'], 'text-text'],
  ['ghost', ['bg-transparent'], 'text-primary'],
  ['danger', ['bg-danger'], 'text-on-danger'],
];

// the react native jest preset renders ActivityIndicator as a host component of that name
const SPINNER_HOST = 'ActivityIndicator';
const spinners = () => screen.container.queryAll(({ type }) => type === SPINNER_HOST);
const spinnerColor = (): unknown => spinners()[0]?.props.color;

describe('Button', () => {
  it('renders its label and is announced as a button with that label', async () => {
    await renderWithTheme(<Button label={LABEL} onPress={jest.fn()} />);

    expect(screen.getByText(LABEL)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: LABEL })).toBeEnabled();
    expect(screen.getByRole('button', { name: LABEL })).not.toBeBusy();
  });

  it('calls onPress when pressed', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(<Button label={LABEL} onPress={onPress} />);

    await user.press(screen.getByRole('button', { name: LABEL }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is disabled and ignores presses when disabled', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(<Button label={LABEL} onPress={onPress} disabled testID={TEST_ID} />);

    const button = screen.getByRole('button', { name: LABEL });
    await user.press(button);

    expect(onPress).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
    expect(button).not.toBeBusy();
    expect(classesOf(button)).toContain('opacity-disabled');
  });

  it('shows a spinner, announces the loading label as busy and ignores presses while loading', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(
      <Button label={LABEL} onPress={onPress} loading loadingLabel={LOADING_LABEL} />,
    );

    const button = screen.getByRole('button', { name: LOADING_LABEL });
    await user.press(button);

    expect(onPress).not.toHaveBeenCalled();
    expect(button).toBeBusy();
    expect(button).toBeDisabled();
    expect(spinners()).toHaveLength(1);
    // the visible label stays, so the button keeps its size
    expect(screen.getByText(LABEL)).toBeOnTheScreen();
    // loading is not the dimmed disabled look
    expect(classesOf(button)).not.toContain('opacity-disabled');
  });

  it('goes back to its label and accepts presses once loading ends', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    const { rerender } = await renderWithTheme(
      <Button label={LABEL} onPress={onPress} loading loadingLabel={LOADING_LABEL} />,
    );

    await rerender(
      <Button label={LABEL} onPress={onPress} loading={false} loadingLabel={LOADING_LABEL} />,
    );
    await user.press(screen.getByRole('button', { name: LABEL }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(spinners()).toHaveLength(0);
  });

  it('has no spinner when not loading', async () => {
    await renderWithTheme(<Button label={LABEL} onPress={jest.fn()} />);

    expect(spinners()).toHaveLength(0);
  });

  it('passes the accessibility hint', async () => {
    await renderWithTheme(<Button label={LABEL} onPress={jest.fn()} accessibilityHint={HINT} />);

    expect(screen.getByHintText(HINT)).toBe(screen.getByRole('button', { name: LABEL }));
  });

  it('has no accessibility hint by default', async () => {
    await renderWithTheme(<Button label={LABEL} onPress={jest.fn()} testID={TEST_ID} />);

    expect(screen.getByTestId(TEST_ID).props).not.toHaveProperty('accessibilityHint');
  });

  it('has a full touch target and the pressed feedback', async () => {
    await renderWithTheme(<Button label={LABEL} onPress={jest.fn()} testID={TEST_ID} />);

    expect(classesOf(screen.getByTestId(TEST_ID))).toEqual(
      expect.arrayContaining(['min-h-touch', 'active:opacity-pressed', 'rounded-md']),
    );
  });

  it('is primary by default', async () => {
    await renderWithTheme(<Button label={LABEL} onPress={jest.fn()} testID={TEST_ID} />);

    expect(classesOf(screen.getByTestId(TEST_ID))).toContain('bg-primary');
    expect(classesOf(screen.getByText(LABEL))).toContain('text-on-primary');
  });

  it.each(VARIANTS)(
    'draws the %s variant with its container and label classes',
    async (variant, containerClasses, labelTone) => {
      await renderWithTheme(
        <Button label={LABEL} onPress={jest.fn()} variant={variant} testID={TEST_ID} />,
      );

      expect(classesOf(screen.getByTestId(TEST_ID))).toEqual(
        expect.arrayContaining(containerClasses),
      );
      expect(classesOf(screen.getByText(LABEL))).toStrictEqual([
        'text-label',
        labelTone,
        'text-center',
      ]);
    },
  );

  it.each<[ButtonVariant, keyof typeof palettes.light]>([
    ['primary', 'onPrimary'],
    ['secondary', 'text'],
    ['ghost', 'primary'],
    ['danger', 'onDanger'],
  ])('colors the %s spinner with the %s token', async (variant, token) => {
    await renderWithTheme(
      <Button
        label={LABEL}
        onPress={jest.fn()}
        variant={variant}
        loading
        loadingLabel={LOADING_LABEL}
      />,
    );

    expect(spinnerColor()).toBe(palettes.light[token]);
  });

  it('requires a loading label with loading', async () => {
    // @ts-expect-error(type-test): loading needs a translated loadingLabel for screen readers
    await renderWithTheme(<Button label={LABEL} onPress={jest.fn()} loading />);

    // without it the visible label is announced
    expect(screen.getByRole('button', { name: LABEL })).toBeBusy();
  });
});
