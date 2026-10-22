import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { SheetActions, type SheetActionsProps } from './SheetActions';

const TEST_ID = 'some-sheet';

const renderActions = async (props: Partial<SheetActionsProps> = {}) => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  await renderWithTheme(
    <SheetActions
      confirmLabel="Save"
      cancelLabel="Cancel"
      onConfirm={onConfirm}
      onCancel={onCancel}
      testID={TEST_ID}
      {...props}
    />,
  );
  return { onConfirm, onCancel, user: userEvent.setup() };
};

const button = (name: string) => screen.getByRole('button', { name });

describe('SheetActions', () => {
  it('shows Cancel then the confirm action, two labelled buttons with their test ids', async () => {
    await renderActions();

    expect(
      screen.getAllByRole('button').map((element) => element.props.accessibilityLabel as unknown),
    ).toStrictEqual(['Cancel', 'Save']);
    expect(button('Cancel')).toHaveProp('testID', `${TEST_ID}-cancel`);
    expect(button('Save')).toHaveProp('testID', `${TEST_ID}-confirm`);
    expect(button('Cancel')).toBeEnabled();
    expect(button('Save')).toBeEnabled();
  });

  it('confirms on the confirm button and cancels on Cancel, each once', async () => {
    const { onConfirm, onCancel, user } = await renderActions();

    await user.press(button('Save'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    await user.press(button('Cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables the confirm button alone, which then ignores presses', async () => {
    const { onConfirm, onCancel, user } = await renderActions({ confirmDisabled: true });

    expect(button('Save')).toBeDisabled();
    expect(button('Save')).toHaveProp('accessibilityState', { disabled: true, busy: false });
    expect(button('Cancel')).toBeEnabled();

    await user.press(button('Save'));

    expect(onConfirm).not.toHaveBeenCalled();

    await user.press(button('Cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the given cancel label', async () => {
    await renderActions({ cancelLabel: 'Annuler' });

    expect(button('Annuler')).toHaveProp('testID', `${TEST_ID}-cancel`);
  });

  it.each([
    ['primary by default', {}, 'bg-primary'],
    ['danger for a destructive action', { confirmVariant: 'danger' as const }, 'bg-danger'],
  ])('draws the confirm button %s, Cancel always secondary', async (_case, props, container) => {
    await renderActions({ confirmLabel: 'Remove', ...props });

    expect(classesOf(button('Remove'))).toContain(container);
    expect(classesOf(button('Cancel'))).toContain('bg-surface-muted');
  });
});
