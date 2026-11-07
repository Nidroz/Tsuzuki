import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, userEvent } from '@testing-library/react-native';
import {
  type EmitterSubscription,
  Keyboard,
  type KeyboardEvent,
  type KeyboardEventName,
  Platform,
} from 'react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { Sheet, type SheetProps } from './Sheet';
import { Text } from './Text';

const TITLE = 'Filters';
const CLOSE_LABEL = 'Close the filters';
const BODY = 'Body content';
const FOOTER = 'Footer content';
const TEST_ID = 'sheet';

// a panel laid out from y 300 to 800 and a keyboard from y 600 down: they overlap by 200
const PANEL_FRAME = { x: 0, y: 300, width: 400, height: 500 };
const KEYBOARD_TOP = 600;
const KEYBOARD_OVERLAP = PANEL_FRAME.y + PANEL_FRAME.height - KEYBOARD_TOP;
const KEYBOARD_SHOWN: KeyboardEvent = {
  duration: 0,
  easing: 'keyboard',
  endCoordinates: { screenX: 0, screenY: KEYBOARD_TOP, width: 400, height: 300 },
  startCoordinates: { screenX: 0, screenY: 800, width: 400, height: 300 },
  isEventFromThisApp: true,
};
const KEYBOARD_HIDDEN: KeyboardEvent = {
  ...KEYBOARD_SHOWN,
  endCoordinates: KEYBOARD_SHOWN.startCoordinates ?? KEYBOARD_SHOWN.endCoordinates,
};

const renderSheet = async (props: Partial<SheetProps> = {}) => {
  const onClose = jest.fn();
  await renderWithTheme(
    <Sheet
      visible
      title={TITLE}
      closeLabel={CLOSE_LABEL}
      onClose={onClose}
      footer={<Text>{FOOTER}</Text>}
      testID={TEST_ID}
      {...props}
    >
      <Text>{BODY}</Text>
    </Sheet>,
  );
  return { onClose };
};

describe('Sheet', () => {
  it('slides up a transparent modal with its title as a heading, its body and its footer', async () => {
    await renderSheet();

    const modal = screen.getByTestId(TEST_ID);

    expect(modal).toHaveProp('animationType', 'slide');
    expect(modal).toHaveProp('transparent', true);
    expect(screen.getByRole('header', { name: TITLE })).toBeOnTheScreen();
    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(screen.getByText(FOOTER)).toBeOnTheScreen();
  });

  it('renders nothing while closed', async () => {
    await renderSheet({ visible: false });

    expect(screen.queryByText(TITLE)).not.toBeOnTheScreen();
    expect(screen.queryByText(BODY)).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: CLOSE_LABEL })).not.toBeOnTheScreen();
  });

  it('has a close button named by its label, which closes it', async () => {
    const user = userEvent.setup();
    const { onClose } = await renderSheet();

    const close = screen.getByRole('button', { name: CLOSE_LABEL });
    expect(close).toBe(screen.getByTestId(`${TEST_ID}-close`));

    await user.press(close);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on the android back button and on a backdrop tap', async () => {
    const user = userEvent.setup();
    const { onClose } = await renderSheet();

    await fireEvent(screen.getByTestId(TEST_ID), 'requestClose');
    await user.press(screen.getByTestId(`${TEST_ID}-backdrop`, { includeHiddenElements: true }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps the backdrop out of the accessibility tree, dimming the screen with the scrim', async () => {
    await renderSheet();

    const backdrop = screen.getByTestId(`${TEST_ID}-backdrop`, { includeHiddenElements: true });

    expect(backdrop).toHaveProp('accessible', false);
    expect(backdrop).toHaveProp('importantForAccessibility', 'no');
    expect(classesOf(backdrop)).toStrictEqual([
      'absolute',
      'inset-none',
      'bg-scrim',
      'opacity-scrim',
    ]);
  });

  it('wraps the whole panel, not the backdrop, in the keyboard avoiding view', async () => {
    await renderSheet();

    const panel = screen.getByTestId(`${TEST_ID}-keyboard`);
    const backdrop = screen.getByTestId(`${TEST_ID}-backdrop`, { includeHiddenElements: true });

    expect(panel).toHaveProp('accessibilityViewIsModal', true);
    expect(panel).toContainElement(screen.getByRole('header', { name: TITLE }));
    expect(panel).toContainElement(screen.getByText(BODY));
    expect(panel).toContainElement(screen.getByText(FOOTER));
    expect(panel).not.toContainElement(backdrop);
    expect(classesOf(panel)).toStrictEqual(['shrink']);
  });

  // the keyboard would cover the fields and the actions near the bottom of the panel. the padding
  // behavior is checked by its effect: the panel gets a bottom padding of the keyboard's overlap
  describe.each<[os: 'ios' | 'android', show: KeyboardEventName, hide: KeyboardEventName]>([
    ['ios', 'keyboardWillShow', 'keyboardWillHide'],
    ['android', 'keyboardDidShow', 'keyboardDidHide'],
  ])('on %s', (os, showEvent, hideEvent) => {
    it('lifts its panel above the keyboard with a bottom padding, then drops it', async () => {
      jest.replaceProperty(Platform, 'OS', os);
      const listeners = new Map<KeyboardEventName, (event: KeyboardEvent) => void>();
      jest.spyOn(Keyboard, 'addListener').mockImplementation((eventType, listener) => {
        listeners.set(eventType, listener);
        return { remove: jest.fn() } as unknown as EmitterSubscription;
      });
      await renderSheet();
      const panel = screen.getByTestId(`${TEST_ID}-keyboard`);

      expect(panel).toHaveStyle({ paddingBottom: 0 });

      await fireEvent(panel, 'layout', {
        persist: jest.fn(),
        nativeEvent: { layout: PANEL_FRAME },
      });
      await act(async () => {
        listeners.get(showEvent)?.(KEYBOARD_SHOWN);
        await Promise.resolve();
      });

      expect(panel).toHaveStyle({ paddingBottom: KEYBOARD_OVERLAP });

      await act(async () => {
        listeners.get(hideEvent)?.(KEYBOARD_HIDDEN);
        await Promise.resolve();
      });

      expect(panel).toHaveStyle({ paddingBottom: 0 });
    });
  });

  it('renders no footer area without a footer', async () => {
    await renderSheet({ footer: undefined });

    expect(screen.queryByText(FOOTER)).not.toBeOnTheScreen();
    expect(screen.getByText(BODY)).toBeOnTheScreen();
  });
});
