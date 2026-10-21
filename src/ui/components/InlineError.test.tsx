import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { InlineError } from './InlineError';

const MESSAGE = 'Your change could not be saved.';
const OTHER_MESSAGE = 'Your library could not be read.';
const ACTION_LABEL = 'Dismiss';
const TEST_ID = 'inline-error';

// the react native jest preset already mocks announceForAccessibility: spyOn hands back that shared
// mock, whose calls survive restoreMocks, so they are cleared here
const spyOnAnnounce = () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  announce.mockClear();
  return announce;
};

describe('InlineError', () => {
  it('shows its message in the danger tone, in a bordered alert, without an action by default', async () => {
    await renderWithTheme(<InlineError message={MESSAGE} testID={TEST_ID} />);

    const alert = screen.getByTestId(TEST_ID);

    expect(alert).toHaveProp('accessibilityRole', 'alert');
    expect(alert).toHaveTextContent(MESSAGE, { exact: true });
    expect(classesOf(alert)).toEqual(expect.arrayContaining(['border', 'border-danger']));
    expect(classesOf(screen.getByText(MESSAGE))).toContain('text-danger');
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('shows an action that calls onPress, reachable by screen readers', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(
      <InlineError message={MESSAGE} action={{ label: ACTION_LABEL, onPress }} testID={TEST_ID} />,
    );

    expect(screen.getByTestId(TEST_ID)).not.toHaveProp('accessible', true);
    await user.press(screen.getByRole('button', { name: ACTION_LABEL }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(`${TEST_ID}-action`)).toBe(
      screen.getByRole('button', { name: ACTION_LABEL }),
    );
  });

  it('announces its message on mount and when it changes only', async () => {
    const announce = spyOnAnnounce();
    const { rerender } = await renderWithTheme(<InlineError message={MESSAGE} />);

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith(MESSAGE);

    await rerender(
      <InlineError message={MESSAGE} action={{ label: ACTION_LABEL, onPress: jest.fn() }} />,
    );

    expect(announce).toHaveBeenCalledTimes(1);

    await rerender(<InlineError message={OTHER_MESSAGE} />);

    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith(OTHER_MESSAGE);
  });
});
