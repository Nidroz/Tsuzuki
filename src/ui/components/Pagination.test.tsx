import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { PAGINATION_LABELS as LABELS } from './__fixtures__/pagination-labels';
import { Pagination } from './Pagination';
import { pageWindow } from './pagination/page-window';

const TEST_ID = 'pagination';
const ELLIPSIS_GLYPH = '…';

interface RenderOptions {
  page: number;
  pageCount: number;
  siblings?: number;
  testID?: string;
}

const renderPagination = async ({ page, pageCount, siblings, testID = TEST_ID }: RenderOptions) => {
  const onPageChange = jest.fn<(page: number) => void>();
  const result = await renderWithTheme(
    <Pagination
      page={page}
      pageCount={pageCount}
      onPageChange={onPageChange}
      labels={LABELS}
      {...(siblings !== undefined && { siblings })}
      testID={testID}
    />,
  );
  return { ...result, onPageChange };
};

const previousButton = () => screen.getByRole('button', { name: LABELS.previous });
const nextButton = () => screen.getByRole('button', { name: LABELS.next });
const pageButton = (page: number) => screen.getByRole('button', { name: LABELS.page(page) });
const currentPageButton = (page: number, pageCount: number) =>
  screen.getByRole('button', { name: LABELS.currentPage(page, pageCount) });
const jumpInput = () => screen.getByLabelText(LABELS.jumpTo);
const jumpSubmit = () => screen.getByRole('button', { name: LABELS.jumpSubmit });

// the page numbers shown, in order, with the ellipses
const shownItems = () =>
  screen
    .getAllByRole('text')
    .map((text) => {
      const label: unknown = text.props.accessibilityLabel;
      return label === LABELS.ellipsis
        ? label
        : text.children.filter((child) => typeof child === 'string').join('');
    })
    .filter((content) => content === LABELS.ellipsis || /^\d+$/u.test(content))
    .map((content) => (content === LABELS.ellipsis ? 'ellipsis' : Number(content)));

describe('Pagination', () => {
  describe('with one page or none', () => {
    it.each([
      ['no page', 0],
      ['one page', 1],
      ['a fractional page count below two', 1.9],
      ['a negative page count', -3],
      ['a NaN page count', Number.NaN],
    ])('renders nothing with %s', async (_label, pageCount) => {
      await renderPagination({ page: 1, pageCount });

      expect(screen.queryByTestId(TEST_ID)).not.toBeOnTheScreen();
      expect(screen.queryByRole('button')).not.toBeOnTheScreen();
      expect(screen.queryByLabelText(LABELS.jumpTo)).not.toBeOnTheScreen();
    });
  });

  describe('previous and next', () => {
    it('disables previous on the first page', async () => {
      await renderPagination({ page: 1, pageCount: 5 });

      expect(previousButton()).toBeDisabled();
      expect(nextButton()).toBeEnabled();
    });

    it('disables next on the last page', async () => {
      await renderPagination({ page: 5, pageCount: 5 });

      expect(previousButton()).toBeEnabled();
      expect(nextButton()).toBeDisabled();
    });

    it('enables both in the middle', async () => {
      await renderPagination({ page: 3, pageCount: 5 });

      expect(previousButton()).toBeEnabled();
      expect(nextButton()).toBeEnabled();
    });

    it('requests the previous page', async () => {
      const user = userEvent.setup();
      const { onPageChange } = await renderPagination({ page: 3, pageCount: 5 });

      await user.press(previousButton());

      expect(onPageChange).toHaveBeenCalledTimes(1);
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('requests the next page', async () => {
      const user = userEvent.setup();
      const { onPageChange } = await renderPagination({ page: 3, pageCount: 5 });

      await user.press(nextButton());

      expect(onPageChange).toHaveBeenCalledTimes(1);
      expect(onPageChange).toHaveBeenCalledWith(4);
    });

    it('ignores presses on previous on the first page and on next on the last page', async () => {
      const user = userEvent.setup();
      const first = await renderPagination({ page: 1, pageCount: 2 });

      await user.press(previousButton());
      expect(first.onPageChange).not.toHaveBeenCalled();

      await first.unmount();
      const last = await renderPagination({ page: 2, pageCount: 2 });
      await user.press(nextButton());

      expect(last.onPageChange).not.toHaveBeenCalled();
    });
  });

  describe('page buttons', () => {
    it('labels each page and marks the current one as selected with its own label', async () => {
      await renderPagination({ page: 2, pageCount: 3 });

      expect(pageButton(1)).not.toBeSelected();
      expect(currentPageButton(2, 3)).toBeSelected();
      expect(pageButton(3)).not.toBeSelected();
      expect(screen.queryByRole('button', { name: LABELS.page(2) })).not.toBeOnTheScreen();
      expect(screen.getAllByRole('button', { selected: true })).toHaveLength(1);
    });

    it('requests the pressed page', async () => {
      const user = userEvent.setup();
      const { onPageChange } = await renderPagination({ page: 2, pageCount: 3 });

      await user.press(pageButton(3));

      expect(onPageChange).toHaveBeenCalledTimes(1);
      expect(onPageChange).toHaveBeenCalledWith(3);
    });

    it('never requests the current page', async () => {
      const user = userEvent.setup();
      const { onPageChange } = await renderPagination({ page: 2, pageCount: 3 });

      await user.press(currentPageButton(2, 3));

      expect(onPageChange).not.toHaveBeenCalled();
    });

    it.each([
      ['every page when they fit', 3, 5, undefined],
      ['an ellipsis on both sides in the middle', 10, 20, undefined],
      ['an ellipsis after the start', 1, 20, undefined],
      ['an ellipsis before the end', 20, 20, undefined],
      ['a wider window with two siblings', 10, 20, 2],
      ['no sibling', 10, 20, 0],
    ])('shows the page window: %s', async (_label, page, pageCount, siblings) => {
      await renderPagination({ page, pageCount, ...(siblings !== undefined && { siblings }) });

      expect(shownItems()).toStrictEqual(
        pageWindow({ page, pageCount, ...(siblings !== undefined && { siblings }) }),
      );
    });

    it('announces each ellipsis with its label and draws the ellipsis glyph', async () => {
      await renderPagination({ page: 10, pageCount: 20 });

      const ellipses = screen.getAllByLabelText(LABELS.ellipsis);

      expect(ellipses).toHaveLength(2);
      for (const ellipsis of ellipses) {
        expect(ellipsis).toHaveTextContent(ELLIPSIS_GLYPH);
      }
    });

    it('has no ellipsis when every page fits', async () => {
      await renderPagination({ page: 2, pageCount: 4 });

      expect(screen.queryByLabelText(LABELS.ellipsis)).not.toBeOnTheScreen();
    });
  });

  describe('out of range input', () => {
    it('clamps a page after the last one to the last page', async () => {
      const user = userEvent.setup();
      const { onPageChange } = await renderPagination({ page: 50, pageCount: 10 });

      expect(currentPageButton(10, 10)).toBeSelected();
      expect(nextButton()).toBeDisabled();

      await user.press(previousButton());

      expect(onPageChange).toHaveBeenCalledWith(9);
    });

    it('clamps page 0 to the first page', async () => {
      const user = userEvent.setup();
      const { onPageChange } = await renderPagination({ page: 0, pageCount: 10 });

      expect(currentPageButton(1, 10)).toBeSelected();
      expect(previousButton()).toBeDisabled();

      await user.press(nextButton());

      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('truncates a fractional page count', async () => {
      await renderPagination({ page: 5, pageCount: 5.7 });

      expect(currentPageButton(5, 5)).toBeSelected();
      expect(nextButton()).toBeDisabled();
    });
  });

  describe('test ids', () => {
    it('derives the ids of its parts from testID', async () => {
      await renderPagination({ page: 2, pageCount: 3 });

      expect(screen.getByTestId(TEST_ID)).toBeOnTheScreen();
      expect(screen.getByTestId(`${TEST_ID}-previous`)).toBe(previousButton());
      expect(screen.getByTestId(`${TEST_ID}-next`)).toBe(nextButton());
      expect(screen.getByTestId(`${TEST_ID}-page-1`)).toBe(pageButton(1));
      expect(screen.getByTestId(`${TEST_ID}-page-2`)).toBe(currentPageButton(2, 3));
      expect(screen.getByTestId(`${TEST_ID}-jump-input`)).toBe(jumpInput());
      expect(screen.getByTestId(`${TEST_ID}-jump-submit`)).toBe(jumpSubmit());
    });

    it('sets no test id without testID', async () => {
      await renderWithTheme(
        <Pagination page={2} pageCount={3} onPageChange={jest.fn()} labels={LABELS} />,
      );

      expect(previousButton()).toBeOnTheScreen();
      expect(screen.queryAllByTestId(/./u)).toStrictEqual([]);
    });
  });
});
