import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, userEvent } from '@testing-library/react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { Sheet, type SheetProps } from './Sheet';
import { Text } from './Text';

const TITLE = 'Filters';
const CLOSE_LABEL = 'Close the filters';
const BODY = 'Body content';
const FOOTER = 'Footer content';
const TEST_ID = 'sheet';

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

  it('keeps the backdrop out of the accessibility tree, behind a dimmed token surface', async () => {
    await renderSheet();

    const backdrop = screen.getByTestId(`${TEST_ID}-backdrop`, { includeHiddenElements: true });

    expect(backdrop).toHaveProp('accessible', false);
    expect(backdrop).toHaveProp('importantForAccessibility', 'no');
    expect(classesOf(backdrop)).toStrictEqual([
      'absolute',
      'inset-none',
      'bg-background',
      'opacity-pressed',
    ]);
  });

  it('renders no footer area without a footer', async () => {
    await renderSheet({ footer: undefined });

    expect(screen.queryByText(FOOTER)).not.toBeOnTheScreen();
    expect(screen.getByText(BODY)).toBeOnTheScreen();
  });
});
