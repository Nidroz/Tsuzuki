import { useEffect } from 'react';
import { AccessibilityInfo, Platform, TextInput, View, type TextInputProps } from 'react-native';

import { useThemeColors } from '../theme/theme-context';
import { cx } from './layout/layout-classes';
import { Text } from './Text';

const FIELD = 'min-h-touch rounded-md border bg-surface px-md py-sm text-body text-text';
// the focus border would hide the danger border while the field is focused
const BORDER = 'border-border focus:border-focus';
const ERROR_BORDER = 'border-danger';

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
  /** the error text gets `${testID}-error`, its live region `${testID}-error-region` */
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
      {/* the field carries the label: screen readers would read it twice */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text variant="label">{label}</Text>
      </View>
      <TextInput
        className={cx(FIELD, hasError ? ERROR_BORDER : BORDER)}
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
      {/* talkback reads a live region when its content changes, not when it mounts with it: the
          region stays mounted and the error appears inside it */}
      <View
        accessibilityLiveRegion="polite"
        // fabric flattens a view kept only for its live region and moves its children out of it:
        // talkback would then never see the error appear inside the region
        collapsable={false}
        {...(testID !== undefined && { testID: `${testID}-error-region` })}
      >
        {hasError ? (
          <Text
            variant="caption"
            tone="danger"
            {...(testID !== undefined && { testID: `${testID}-error` })}
          >
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
