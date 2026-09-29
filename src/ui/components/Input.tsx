import { useEffect } from 'react';
import { AccessibilityInfo, Platform, TextInput, View, type TextInputProps } from 'react-native';

import { useThemeColors } from '../theme/theme-context';
import { cx } from './layout/layout-classes';
import { Text } from './Text';

const FIELD =
  'min-h-touch rounded-md border bg-surface px-md py-sm text-body text-text focus:border-focus';

export type InputKeyboardType = 'default' | 'email-address' | 'number-pad' | 'numeric' | 'url';
export type InputReturnKeyType = 'done' | 'go' | 'next' | 'search' | 'send';

export interface InputProps {
  /** translated visible label, also the field's accessibility label */
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** translated error shown under the field and announced by screen readers */
  error?: string;
  secureTextEntry?: boolean;
  keyboardType?: InputKeyboardType;
  returnKeyType?: InputReturnKeyType;
  onSubmitEditing?: () => void;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  /** the error text gets `${testID}-error` */
  testID?: string;
}

/** a labelled single-line text field with an optional error message */
export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  secureTextEntry = false,
  keyboardType = 'default',
  returnKeyType,
  onSubmitEditing,
  autoCapitalize,
  testID,
}: InputProps) {
  const colors = useThemeColors();
  const hasError = error !== undefined && error !== '';

  // android reads the error through its live region; ios has none, so it is announced here
  useEffect(() => {
    if (hasError && Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(error);
    }
  }, [hasError, error]);

  return (
    <View className="gap-xs">
      <Text variant="label">{label}</Text>
      <TextInput
        className={cx(FIELD, hasError ? 'border-danger' : 'border-border')}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.textMuted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        accessibilityLabel={label}
        // the error is read again when the field is focused
        {...(hasError && { accessibilityHint: error })}
        {...(placeholder !== undefined && { placeholder })}
        {...(returnKeyType !== undefined && { returnKeyType })}
        {...(onSubmitEditing !== undefined && { onSubmitEditing })}
        {...(autoCapitalize !== undefined && { autoCapitalize })}
        testID={testID}
      />
      {hasError ? (
        <View accessibilityLiveRegion="polite">
          <Text
            variant="caption"
            tone="danger"
            {...(testID !== undefined && { testID: `${testID}-error` })}
          >
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
