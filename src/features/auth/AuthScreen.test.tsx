import { describe, expect, it } from '@jest/globals';
import { screen } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { AuthMessage, AuthScreen } from './AuthScreen';

describe('AuthScreen', () => {
  it('frames its content with its testID, and AuthMessage titles a message as a heading', async () => {
    await renderWithProviders(
      <AuthScreen testID="auth-test-screen">
        <AuthMessage title="Check your email" message="We sent a link." testID="message" />
      </AuthScreen>,
    );

    expect(screen.getByTestId('auth-test-screen')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Check your email' })).toBeOnTheScreen();
    expect(screen.getByTestId('message')).toHaveTextContent('Check your emailWe sent a link.');
  });
});
