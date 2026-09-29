import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent } from '@testing-library/react-native';

import { classesOf } from '../../../../test/mobile/class-names';
import { PageButton, PageEllipsis } from './PageButton';

const PAGE = 3;
const LABEL = 'Page 3';
const CURRENT_LABEL = 'Page 3 of 12, current page';
const ELLIPSIS_LABEL = 'More pages';
const TEST_ID = 'page-3';
const PAGE_CLASSES = [
  'min-h-touch',
  'min-w-touch',
  'items-center',
  'justify-center',
  'rounded-md',
  'px-sm',
];

describe('PageButton', () => {
  it('shows its page number and is announced as a button with its label', async () => {
    await render(
      <PageButton page={PAGE} selected={false} accessibilityLabel={LABEL} onSelect={jest.fn()} />,
    );

    const button = screen.getByRole('button', { name: LABEL });

    expect(button).toHaveTextContent(String(PAGE));
    expect(button).not.toBeSelected();
    expect(classesOf(button)).toStrictEqual([
      ...PAGE_CLASSES,
      'active:opacity-pressed',
      'bg-transparent',
    ]);
    expect(classesOf(screen.getByText(String(PAGE)))).toContain('text-text');
  });

  it('is highlighted and announced as selected when it is the current page', async () => {
    await render(
      <PageButton page={PAGE} selected accessibilityLabel={CURRENT_LABEL} onSelect={jest.fn()} />,
    );

    const button = screen.getByRole('button', { name: CURRENT_LABEL });

    expect(button).toBeSelected();
    expect(classesOf(button)).toContain('bg-primary');
    expect(classesOf(screen.getByText(String(PAGE)))).toContain('text-on-primary');
  });

  it('calls onSelect with its page when pressed', async () => {
    const onSelect = jest.fn();
    const user = userEvent.setup();
    await render(
      <PageButton page={PAGE} selected={false} accessibilityLabel={LABEL} onSelect={onSelect} />,
    );

    await user.press(screen.getByRole('button', { name: LABEL }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(PAGE);
  });

  it('sets its testID only when given', async () => {
    const { rerender } = await render(
      <PageButton page={PAGE} selected={false} accessibilityLabel={LABEL} onSelect={jest.fn()} />,
    );

    expect(screen.queryAllByTestId(/./u)).toStrictEqual([]);

    await rerender(
      <PageButton
        page={PAGE}
        selected={false}
        accessibilityLabel={LABEL}
        onSelect={jest.fn()}
        testID={TEST_ID}
      />,
    );

    expect(screen.getByTestId(TEST_ID)).toBe(screen.getByRole('button', { name: LABEL }));
  });
});

describe('PageEllipsis', () => {
  it('draws the ellipsis glyph in the muted tone and announces its label instead', async () => {
    await render(<PageEllipsis accessibilityLabel={ELLIPSIS_LABEL} />);

    const ellipsis = screen.getByLabelText(ELLIPSIS_LABEL);

    expect(ellipsis).toHaveTextContent('…');
    expect(classesOf(ellipsis)).toContain('text-text-muted');
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('takes the size of a page button so the row does not jump', async () => {
    await render(<PageEllipsis accessibilityLabel={ELLIPSIS_LABEL} />);

    const container = screen.getByLabelText(ELLIPSIS_LABEL).parent;

    expect(container).not.toBeNull();
    expect(classesOf(container ?? { props: {} })).toStrictEqual(PAGE_CLASSES);
  });
});
