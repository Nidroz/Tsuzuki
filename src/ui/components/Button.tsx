import { ActivityIndicator, Pressable } from 'react-native';

import type { ColorToken } from '../theme/colors';
import { useThemeColors } from '../theme/theme-context';
import { cx } from './layout/layout-classes';
import { Text, type TextTone } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface VariantStyle {
  readonly container: string;
  readonly tone: TextTone;
  readonly spinnerColor: ColorToken;
}

const VARIANT: Readonly<Record<ButtonVariant, VariantStyle>> = {
  primary: { container: 'bg-primary', tone: 'onPrimary', spinnerColor: 'onPrimary' },
  secondary: {
    container: 'border border-border bg-surface-muted',
    tone: 'default',
    spinnerColor: 'text',
  },
  ghost: { container: 'bg-transparent', tone: 'primary', spinnerColor: 'primary' },
  danger: { container: 'bg-danger', tone: 'onDanger', spinnerColor: 'onDanger' },
};

type LoadingProps =
  | { loading?: never; loadingLabel?: never }
  | {
      loading: boolean;
      /** accessibility label announced instead of the label while loading, e.g. "Saving" */
      loadingLabel: string;
    };

export type ButtonProps = LoadingProps & {
  /** translated visible label, also the accessibility label */
  label: string;
  onPress: () => void;
  /** primary by default */
  variant?: ButtonVariant;
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

/** a labelled button; while loading it shows a spinner and ignores presses */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  loadingLabel,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const colors = useThemeColors();
  const style = VARIANT[variant];
  const inactive = disabled || loading;

  return (
    <Pressable
      className={cx(
        'min-h-touch flex-row items-center justify-center gap-sm rounded-md px-lg py-sm',
        'active:opacity-pressed',
        style.container,
        disabled && 'opacity-disabled',
      )}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={loading && loadingLabel !== undefined ? loadingLabel : label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      {...(accessibilityHint !== undefined && { accessibilityHint })}
      testID={testID}
    >
      {loading ? <ActivityIndicator color={colors[style.spinnerColor]} /> : null}
      <Text variant="label" tone={style.tone} align="center">
        {label}
      </Text>
    </Pressable>
  );
}
