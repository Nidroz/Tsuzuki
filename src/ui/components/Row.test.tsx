import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { spacing, type SpacingToken } from '../theme/spacing';
import { ALIGN, GAP, JUSTIFY, type AlignToken, type JustifyToken } from './layout/layout-classes';
import { Row } from './Row';

const TEST_ID = 'row';
const SPACING_TOKENS = Object.keys(spacing) as SpacingToken[];
const ALIGN_TOKENS = Object.keys(ALIGN) as AlignToken[];
const JUSTIFY_TOKENS = Object.keys(JUSTIFY) as JustifyToken[];

const renderedClasses = () => classesOf(screen.getByTestId(TEST_ID));

describe('Row', () => {
  it('renders its children in order', async () => {
    await render(
      <Row gap="md" testID={TEST_ID}>
        <Text>left</Text>
        <Text>right</Text>
      </Row>,
    );

    expect(screen.getByTestId(TEST_ID)).toHaveTextContent('leftright');
  });

  it('lays children out horizontally, vertically centered by default, without wrapping', async () => {
    await render(<Row gap="sm" testID={TEST_ID} />);

    expect(renderedClasses()).toStrictEqual(['flex-row', GAP.sm, ALIGN.center]);
  });

  it.each(SPACING_TOKENS)('maps gap %s to its class', async (gap) => {
    await render(<Row gap={gap} testID={TEST_ID} />);

    expect(renderedClasses()).toContain(GAP[gap]);
  });

  it.each(ALIGN_TOKENS)('maps align %s to its class', async (align) => {
    await render(<Row gap="sm" align={align} testID={TEST_ID} />);

    expect(renderedClasses()).toStrictEqual(['flex-row', GAP.sm, ALIGN[align]]);
  });

  it.each(JUSTIFY_TOKENS)('maps justify %s to its class', async (justify) => {
    await render(<Row gap="sm" justify={justify} testID={TEST_ID} />);

    expect(renderedClasses()).toContain(JUSTIFY[justify]);
  });

  it('wraps and fills its parent when asked', async () => {
    await render(<Row gap="xs" align="start" justify="around" wrap flex testID={TEST_ID} />);

    expect(renderedClasses()).toStrictEqual([
      'flex-row',
      'gap-xs',
      'items-start',
      'justify-around',
      'flex-wrap',
      'flex-1',
    ]);
  });

  it('accepts spacing tokens only, not raw numbers', async () => {
    // @ts-expect-error(F-05): raw numbers are not spacing tokens
    await render(<Row gap={4} testID={TEST_ID} />);

    expect(renderedClasses()).toStrictEqual(['flex-row', ALIGN.center]);
  });
});
