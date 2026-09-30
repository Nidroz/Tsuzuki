import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { spacing, type SpacingToken } from '../theme/spacing';
import { ALIGN, GAP, JUSTIFY, type AlignToken, type JustifyToken } from './layout/layout-classes';
import { Stack } from './Stack';

const TEST_ID = 'stack';
const SPACING_TOKENS = Object.keys(spacing) as SpacingToken[];
const ALIGN_TOKENS = Object.keys(ALIGN) as AlignToken[];
const JUSTIFY_TOKENS = Object.keys(JUSTIFY) as JustifyToken[];

const renderedClasses = () => classesOf(screen.getByTestId(TEST_ID));

describe('Stack', () => {
  it('renders its children in order', async () => {
    await render(
      <Stack gap="md" testID={TEST_ID}>
        <Text>first</Text>
        <Text>second</Text>
      </Stack>,
    );

    expect(screen.getByTestId(TEST_ID)).toHaveTextContent('firstsecond');
  });

  it('lays children out vertically, stretched by default, with no justify class', async () => {
    await render(<Stack gap="md" testID={TEST_ID} />);

    expect(renderedClasses()).toStrictEqual(['flex-col', GAP.md]);
  });

  it.each(SPACING_TOKENS)('maps gap %s to its class', async (gap) => {
    await render(<Stack gap={gap} testID={TEST_ID} />);

    expect(renderedClasses()).toStrictEqual(['flex-col', GAP[gap]]);
  });

  it.each(ALIGN_TOKENS)('maps align %s to its class', async (align) => {
    await render(<Stack gap="sm" align={align} testID={TEST_ID} />);

    expect(renderedClasses()).toContain(ALIGN[align]);
  });

  it.each(JUSTIFY_TOKENS)('maps justify %s to its class', async (justify) => {
    await render(<Stack gap="sm" justify={justify} testID={TEST_ID} />);

    expect(renderedClasses()).toContain(JUSTIFY[justify]);
  });

  it('fills its parent with flex', async () => {
    await render(<Stack gap="none" align="center" justify="between" flex testID={TEST_ID} />);

    expect(renderedClasses()).toStrictEqual([
      'flex-col',
      'gap-none',
      'items-center',
      'justify-between',
      'flex-1',
    ]);
  });

  it('accepts spacing tokens only, not raw numbers', async () => {
    // @ts-expect-error(type-test): raw numbers are not spacing tokens
    await render(<Stack gap={12} testID={TEST_ID} />);

    expect(renderedClasses()).toStrictEqual(['flex-col']);
  });
});
