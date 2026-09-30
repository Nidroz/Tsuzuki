import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { PAGINATION_LABELS as LABELS } from './__fixtures__/pagination-labels';
import { Pagination } from './Pagination';

// the jump-to-page field of Pagination; the page buttons are tested in Pagination.test.tsx

const renderPagination = async (page: number, pageCount: number) => {
  const onPageChange = jest.fn<(page: number) => void>();
  const result = await renderWithTheme(
    <Pagination page={page} pageCount={pageCount} onPageChange={onPageChange} labels={LABELS} />,
  );
  return { ...result, onPageChange };
};

const jumpInput = () => screen.getByLabelText(LABELS.jumpTo);
const jumpSubmit = () => screen.getByRole('button', { name: LABELS.jumpSubmit });

describe('Pagination', () => {
  describe('jump to page', () => {
    it('labels the numeric field and its submit button', async () => {
      await renderPagination(1, 10);

      expect(jumpInput()).toHaveProp('keyboardType', 'number-pad');
      expect(jumpInput()).toHaveProp('returnKeyType', 'go');
      expect(jumpSubmit()).toBeEnabled();
    });

    it('requests the typed page and clears the field', async () => {
      const user = userEvent.setup();
      const { onPageChange } = await renderPagination(1, 10);

      await user.type(jumpInput(), '7');
      await user.press(jumpSubmit());

      expect(onPageChange).toHaveBeenCalledTimes(1);
      expect(onPageChange).toHaveBeenCalledWith(7);
      expect(jumpInput()).toHaveDisplayValue('');
    });

    it('requests the typed page from the keyboard submit key', async () => {
      const user = userEvent.setup();
      const { onPageChange } = await renderPagination(1, 10);

      await user.type(jumpInput(), '4', { submitEditing: true });

      expect(onPageChange).toHaveBeenCalledWith(4);
    });

    it('clamps a page after the last one to the last page', async () => {
      const user = userEvent.setup();
      const { onPageChange } = await renderPagination(1, 10);

      await user.type(jumpInput(), '99');
      await user.press(jumpSubmit());

      expect(onPageChange).toHaveBeenCalledWith(10);
    });

    it('clamps page 0 to the first page', async () => {
      const user = userEvent.setup();
      const { onPageChange } = await renderPagination(5, 10);

      await user.type(jumpInput(), '0');
      await user.press(jumpSubmit());

      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it.each(['abc', '-2', '2.5', ''])('ignores %p and keeps the text', async (text) => {
      const user = userEvent.setup();
      const { onPageChange } = await renderPagination(1, 10);

      if (text !== '') {
        await user.type(jumpInput(), text);
      }
      await user.press(jumpSubmit());

      expect(onPageChange).not.toHaveBeenCalled();
      expect(jumpInput()).toHaveDisplayValue(text);
    });

    it('does not request the current page, and clears the field', async () => {
      const user = userEvent.setup();
      const { onPageChange } = await renderPagination(3, 10);

      await user.type(jumpInput(), '3');
      await user.press(jumpSubmit());

      expect(onPageChange).not.toHaveBeenCalled();
      expect(jumpInput()).toHaveDisplayValue('');
    });

    it('does not request the clamped current page for a page past the end', async () => {
      const user = userEvent.setup();
      const { onPageChange } = await renderPagination(10, 10);

      await user.type(jumpInput(), '25');
      await user.press(jumpSubmit());

      expect(onPageChange).not.toHaveBeenCalled();
    });
  });
});
