import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { spacing, type SpacingToken } from '../theme/spacing';
import { SQUARE } from './layout/layout-classes';
import { Spacer } from './Spacer';

const TEST_ID = 'spacer';
const SPACING_TOKENS = Object.keys(spacing) as SpacingToken[];

describe('Spacer', () => {
  it.each(SPACING_TOKENS)('takes a square of the %s spacing token', async (size) => {
    await render(<Spacer size={size} testID={TEST_ID} />);

    expect(classesOf(screen.getByTestId(TEST_ID, { includeHiddenElements: true }))).toStrictEqual(
      SQUARE[size].split(' '),
    );
  });

  it('fills the remaining space when flexible', async () => {
    await render(<Spacer flex testID={TEST_ID} />);

    expect(classesOf(screen.getByTestId(TEST_ID, { includeHiddenElements: true }))).toStrictEqual([
      'flex-1',
    ]);
  });

  it('is hidden from screen readers', async () => {
    await render(<Spacer size="md" testID={TEST_ID} />);

    const spacer = screen.getByTestId(TEST_ID, { includeHiddenElements: true });

    expect(spacer).toHaveProp('accessibilityElementsHidden', true);
    expect(spacer).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    expect(screen.queryByTestId(TEST_ID)).not.toBeOnTheScreen();
  });

  it('accepts spacing tokens only: a raw number is a type error and adds no class', async () => {
    // @ts-expect-error(type-test): raw numbers are not spacing tokens
    await render(<Spacer size={8} testID={TEST_ID} />);

    expect(
      screen.getByTestId(TEST_ID, { includeHiddenElements: true }).props.className,
    ).toBeUndefined();
  });

  it('takes a size or flex, never both', async () => {
    // @ts-expect-error(type-test): a spacer is either fixed or flexible
    await render(<Spacer size="md" flex testID={TEST_ID} />);

    // flex wins at run time
    expect(classesOf(screen.getByTestId(TEST_ID, { includeHiddenElements: true }))).toStrictEqual([
      'flex-1',
    ]);
  });
});
