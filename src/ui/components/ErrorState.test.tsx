import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { ErrorState } from './ErrorState';

const TITLE = 'Something went wrong';
const MESSAGE = 'Check your connection';
const RETRY_LABEL = 'Try again';
const TEST_ID = 'error-state';

describe('ErrorState', () => {
  // the container is not an accessibility element (its retry button must stay reachable), so role
  // queries do not match it: the alert role and the live region are asserted as props
  it('has the alert role and an assertive live region', async () => {
    await renderWithTheme(<ErrorState title={TITLE} testID={TEST_ID} />);

    const alert = screen.getByTestId(TEST_ID);

    expect(alert).toHaveProp('accessibilityRole', 'alert');
    expect(alert).toHaveProp('accessibilityLiveRegion', 'assertive');
    expect(classesOf(alert)).toEqual(
      expect.arrayContaining(['flex-1', 'items-center', 'justify-center']),
    );
  });

  it('shows its title alone by default, in the danger tone', async () => {
    await renderWithTheme(<ErrorState title={TITLE} testID={TEST_ID} />);

    expect(classesOf(screen.getByText(TITLE))).toEqual(
      expect.arrayContaining(['text-subtitle', 'text-danger', 'text-center']),
    );
    expect(screen.getByTestId(TEST_ID)).toHaveTextContent(TITLE, { exact: true });
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('shows its message in the muted tone', async () => {
    await renderWithTheme(<ErrorState title={TITLE} message={MESSAGE} testID={TEST_ID} />);

    expect(screen.getByTestId(TEST_ID)).toContainElement(screen.getByText(MESSAGE));
    expect(classesOf(screen.getByText(MESSAGE))).toContain('text-text-muted');
  });

  it('shows a retry button that calls onPress', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(<ErrorState title={TITLE} retry={{ label: RETRY_LABEL, onPress }} />);

    await user.press(screen.getByRole('button', { name: RETRY_LABEL }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
