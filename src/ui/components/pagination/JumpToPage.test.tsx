import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithTheme } from '../../../../test/mobile/render-with-theme';
import { JumpToPage } from './JumpToPage';

const LABEL = 'Go to page';
const SUBMIT_LABEL = 'Go';
const INPUT_TEST_ID = 'jump-input';
const SUBMIT_TEST_ID = 'jump-submit';

const renderJumpToPage = async (page: number, pageCount: number) => {
  const onPageChange = jest.fn<(page: number) => void>();
  await renderWithTheme(
    <JumpToPage
      page={page}
      pageCount={pageCount}
      onPageChange={onPageChange}
      label={LABEL}
      submitLabel={SUBMIT_LABEL}
      inputTestID={INPUT_TEST_ID}
      submitTestID={SUBMIT_TEST_ID}
    />,
  );
  return onPageChange;
};

const input = () => screen.getByLabelText(LABEL);
const submit = () => screen.getByRole('button', { name: SUBMIT_LABEL });

describe('JumpToPage', () => {
  it('shows an empty numeric field and a submit button, with their test ids', async () => {
    await renderJumpToPage(1, 10);

    expect(input()).toHaveDisplayValue('');
    expect(input()).toHaveProp('keyboardType', 'number-pad');
    expect(screen.getByTestId(INPUT_TEST_ID)).toBe(input());
    expect(screen.getByTestId(SUBMIT_TEST_ID)).toBe(submit());
  });

  it.each([
    ['a page in range', '6', 6],
    ['the last page', '10', 10],
    ['a page past the end, clamped', '11', 10],
    ['page 0, clamped', '0', 1],
    ['a page with spaces and leading zeros', ' 07 ', 7],
  ])('requests %s and clears the field', async (_label, text, expected) => {
    const user = userEvent.setup();
    const onPageChange = await renderJumpToPage(2, 10);

    await user.type(input(), text);
    await user.press(submit());

    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenCalledWith(expected);
    expect(input()).toHaveDisplayValue('');
  });

  it.each(['x', '1.5', '-1', '1e1'])('ignores %p and keeps it in the field', async (text) => {
    const user = userEvent.setup();
    const onPageChange = await renderJumpToPage(2, 10);

    await user.type(input(), text);
    await user.press(submit());

    expect(onPageChange).not.toHaveBeenCalled();
    expect(input()).toHaveDisplayValue(text);
  });

  it('ignores a submit with an empty field', async () => {
    const user = userEvent.setup();
    const onPageChange = await renderJumpToPage(2, 10);

    await user.press(submit());

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('does not request the current page, and clears the field', async () => {
    const user = userEvent.setup();
    const onPageChange = await renderJumpToPage(2, 10);

    await user.type(input(), '2', { submitEditing: true });

    expect(onPageChange).not.toHaveBeenCalled();
    expect(input()).toHaveDisplayValue('');
  });

  it('submits from the keyboard', async () => {
    const user = userEvent.setup();
    const onPageChange = await renderJumpToPage(2, 10);

    await user.type(input(), '5', { submitEditing: true });

    expect(onPageChange).toHaveBeenCalledWith(5);
  });

  it('sets no test id when none is given', async () => {
    await renderWithTheme(
      <JumpToPage
        page={1}
        pageCount={3}
        onPageChange={jest.fn()}
        label={LABEL}
        submitLabel={SUBMIT_LABEL}
      />,
    );

    expect(input()).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/./u)).toStrictEqual([]);
  });
});
