import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { Button } from './Button';
import { Notice } from './Notice';

const MESSAGE = '2 changes could not be synced.';
const OTHER_MESSAGE = '1 change could not be synced.';
const ACTION_LABEL = 'Try again';
const TEST_ID = 'notice';

// the react native jest preset already mocks announceForAccessibility: spyOn hands back that shared
// mock, whose calls survive restoreMocks, so they are cleared here
const spyOnAnnounce = () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  announce.mockClear();
  return announce;
};

describe('Notice', () => {
  it('shows its message as one alert named by it, in a bordered panel, without actions by default', async () => {
    await renderWithTheme(<Notice message={MESSAGE} testID={TEST_ID} />);

    const alert = screen.getByRole('alert', { name: MESSAGE });

    expect(alert).toBe(screen.getByTestId(`${TEST_ID}-message`));
    expect(alert).toHaveTextContent(MESSAGE, { exact: true });
    expect(classesOf(screen.getByTestId(TEST_ID))).toEqual(
      expect.arrayContaining(['border', 'border-border', 'bg-surface']),
    );
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('shows its actions under the message, outside the alert, reachable by screen readers', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(
      <Notice message={MESSAGE} testID={TEST_ID}>
        <Button label={ACTION_LABEL} onPress={onPress} />
      </Notice>,
    );

    const alert = screen.getByRole('alert', { name: MESSAGE });
    expect(within(alert).queryByRole('button')).not.toBeOnTheScreen();
    expect(screen.getByTestId(TEST_ID)).not.toHaveProp('accessible', true);

    await user.press(screen.getByRole('button', { name: ACTION_LABEL }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('announces its message on mount and when it changes only', async () => {
    const announce = spyOnAnnounce();
    const { rerender } = await renderWithTheme(<Notice message={MESSAGE} />);

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith(MESSAGE);

    await rerender(
      <Notice message={MESSAGE}>
        <Button label={ACTION_LABEL} onPress={jest.fn()} />
      </Notice>,
    );

    expect(announce).toHaveBeenCalledTimes(1);

    await rerender(<Notice message={OTHER_MESSAGE} />);

    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith(OTHER_MESSAGE);
  });
});
