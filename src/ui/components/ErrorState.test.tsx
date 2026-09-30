import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { ErrorState } from './ErrorState';

const TITLE = 'Something went wrong';
const OTHER_TITLE = 'Could not load your library';
const MESSAGE = 'Check your connection';
const OTHER_MESSAGE = 'Try again in a moment';
const RETRY_LABEL = 'Try again';
const TEST_ID = 'error-state';

// the react native jest preset already mocks announceForAccessibility: spyOn hands back that shared
// mock, whose calls survive restoreMocks, so they are cleared here
const spyOnAnnounce = () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  announce.mockClear();
  return announce;
};

describe('ErrorState', () => {
  // the container is not an accessibility element (its retry button must stay reachable), so role
  // queries do not match it: the alert role is asserted as a prop. it has no live region: the
  // explicit announcement covers both platforms, and a live region would read it twice on android
  it('has the alert role and no live region', async () => {
    await renderWithTheme(<ErrorState title={TITLE} testID={TEST_ID} />);

    const alert = screen.getByTestId(TEST_ID);

    expect(alert).toHaveProp('accessibilityRole', 'alert');
    expect(alert).not.toHaveProp('accessibilityLiveRegion');
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

  // android live regions stay silent on mount, so both platforms announce the error themselves
  describe.each(['ios', 'android'] as const)('on %s', (os) => {
    it('announces its title alone when it has no message', async () => {
      jest.replaceProperty(Platform, 'OS', os);
      const announce = spyOnAnnounce();

      await renderWithTheme(<ErrorState title={TITLE} />);

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenLastCalledWith(TITLE);
    });

    it('announces its title then its message on a new line', async () => {
      jest.replaceProperty(Platform, 'OS', os);
      const announce = spyOnAnnounce();

      await renderWithTheme(<ErrorState title={TITLE} message={MESSAGE} />);

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenLastCalledWith(`${TITLE}\n${MESSAGE}`);
    });

    it('announces again when its title or message changes, not when other props change', async () => {
      jest.replaceProperty(Platform, 'OS', os);
      const announce = spyOnAnnounce();
      const { rerender } = await renderWithTheme(<ErrorState title={TITLE} />);

      expect(announce).toHaveBeenCalledTimes(1);

      await rerender(
        <ErrorState
          title={TITLE}
          retry={{ label: RETRY_LABEL, onPress: jest.fn() }}
          testID={TEST_ID}
        />,
      );

      expect(announce).toHaveBeenCalledTimes(1);

      await rerender(<ErrorState title={OTHER_TITLE} />);

      expect(announce).toHaveBeenCalledTimes(2);
      expect(announce).toHaveBeenLastCalledWith(OTHER_TITLE);

      await rerender(<ErrorState title={OTHER_TITLE} message={MESSAGE} />);

      expect(announce).toHaveBeenCalledTimes(3);
      expect(announce).toHaveBeenLastCalledWith(`${OTHER_TITLE}\n${MESSAGE}`);

      await rerender(<ErrorState title={OTHER_TITLE} message={OTHER_MESSAGE} />);

      expect(announce).toHaveBeenCalledTimes(4);
      expect(announce).toHaveBeenLastCalledWith(`${OTHER_TITLE}\n${OTHER_MESSAGE}`);

      await rerender(<ErrorState title={OTHER_TITLE} />);

      expect(announce).toHaveBeenCalledTimes(5);
      expect(announce).toHaveBeenLastCalledWith(OTHER_TITLE);
    });

    it('keeps the retry button reachable', async () => {
      jest.replaceProperty(Platform, 'OS', os);
      spyOnAnnounce();

      await renderWithTheme(
        <ErrorState
          title={TITLE}
          retry={{ label: RETRY_LABEL, onPress: jest.fn() }}
          testID={TEST_ID}
        />,
      );

      expect(screen.getByTestId(TEST_ID)).not.toHaveProp('accessible', true);
      expect(screen.getByRole('button', { name: RETRY_LABEL })).toBeOnTheScreen();
    });
  });
});
