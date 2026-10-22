import { useTranslation } from '@core/i18n/index';
import { Input } from '@ui/index';

export interface AuthFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  /** the translated problem of the field, empty without one */
  error: string;
  /** the last field of a form submits it from the keyboard */
  onSubmitEditing?: () => void;
  testID: string;
}

// the keyboard return key of the last field submits the form
const submitProps = (onSubmitEditing: (() => void) | undefined) =>
  onSubmitEditing === undefined ? {} : { onSubmitEditing, returnKeyType: 'go' as const };

/** the email field of the auth forms: an email keyboard, no capitals or autocorrect, autofill */
export function EmailField({
  value,
  onChangeText,
  error,
  onSubmitEditing,
  testID,
}: AuthFieldProps) {
  const { t } = useTranslation();
  return (
    <Input
      label={t('auth.fields.email')}
      value={value}
      onChangeText={onChangeText}
      error={error}
      keyboardType="email-address"
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="email"
      testID={testID}
      {...submitProps(onSubmitEditing)}
    />
  );
}

export interface PasswordFieldProps extends AuthFieldProps {
  /** translated label: password, new password or their confirmation */
  label: string;
  /** `password` to sign in, `new-password` for a password being chosen (password managers) */
  autoComplete: 'password' | 'new-password';
}

/** a password field of the auth forms: hidden text, never capitalized or corrected */
export function PasswordField({
  label,
  autoComplete,
  value,
  onChangeText,
  error,
  onSubmitEditing,
  testID,
}: PasswordFieldProps) {
  return (
    <Input
      label={label}
      value={value}
      onChangeText={onChangeText}
      error={error}
      secureTextEntry
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete={autoComplete}
      testID={testID}
      {...submitProps(onSubmitEditing)}
    />
  );
}
