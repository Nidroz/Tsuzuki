import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { EmailField, PasswordField } from './AuthFields';

describe('EmailField', () => {
  it('is a labelled email field for autofill, without capitals or autocorrect', async () => {
    await renderWithProviders(
      <EmailField value="" onChangeText={jest.fn()} error="" testID="email" />,
    );

    const field = screen.getByLabelText('Email');

    expect(field).toHaveProp('keyboardType', 'email-address');
    expect(field).toHaveProp('autoCapitalize', 'none');
    expect(field).toHaveProp('autoCorrect', false);
    expect(field).toHaveProp('autoComplete', 'email');
    expect(field).toHaveProp('textContentType', 'emailAddress');
    expect(field.props).not.toHaveProperty('onSubmitEditing');
  });

  it('shows its error and submits from the keyboard when it is the last field', async () => {
    const onSubmitEditing = jest.fn();
    await renderWithProviders(
      <EmailField
        value=""
        onChangeText={jest.fn()}
        error="Enter your email address."
        onSubmitEditing={onSubmitEditing}
        testID="email"
      />,
    );

    expect(screen.getByTestId('email-error')).toHaveTextContent('Enter your email address.');
    expect(screen.getByLabelText('Email')).toHaveProp('returnKeyType', 'go');

    await userEvent.setup().type(screen.getByLabelText('Email'), 'a', { submitEditing: true });

    expect(onSubmitEditing).toHaveBeenCalledTimes(1);
  });
});

describe('PasswordField', () => {
  it.each(['password', 'new-password'] as const)(
    'hides the %s it holds and gives password managers its kind',
    async (autoComplete) => {
      await renderWithProviders(
        <PasswordField
          label="Password"
          autoComplete={autoComplete}
          value=""
          onChangeText={jest.fn()}
          error=""
          testID="password"
        />,
      );

      const field = screen.getByLabelText('Password');

      expect(field).toHaveProp('secureTextEntry', true);
      expect(field).toHaveProp('autoCapitalize', 'none');
      expect(field).toHaveProp('autoCorrect', false);
      expect(field).toHaveProp('autoComplete', autoComplete);
    },
  );
});
