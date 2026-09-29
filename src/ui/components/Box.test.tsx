import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { classesOf } from '../../../test/mobile/class-names';
import type { RadiusToken } from '../theme/radii';
import { spacing, type SpacingToken } from '../theme/spacing';
import { Box } from './Box';
import {
  MARGIN,
  MARGIN_X,
  MARGIN_Y,
  PADDING,
  PADDING_X,
  PADDING_Y,
  RADIUS,
  SURFACE,
  type SurfaceToken,
} from './layout/layout-classes';

const TEST_ID = 'box';
const SPACING_TOKENS = Object.keys(spacing) as SpacingToken[];
const SURFACES: SurfaceToken[] = ['background', 'surface', 'surfaceMuted'];
const RADII: RadiusToken[] = ['none', 'sm', 'md', 'lg', 'full'];

type SpacingProp = 'padding' | 'paddingX' | 'paddingY' | 'margin' | 'marginX' | 'marginY';

const renderedClasses = () => classesOf(screen.getByTestId(TEST_ID));

describe('Box', () => {
  it('renders its children', async () => {
    await render(
      <Box testID={TEST_ID}>
        <Text>inside</Text>
      </Box>,
    );

    expect(screen.getByText('inside')).toBeOnTheScreen();
    expect(screen.getByTestId(TEST_ID)).toContainElement(screen.getByText('inside'));
  });

  it('has no class without token props', async () => {
    await render(<Box testID={TEST_ID} />);

    expect(renderedClasses()).toStrictEqual([]);
  });

  describe.each<[SpacingProp, Readonly<Record<SpacingToken, string>>]>([
    ['padding', PADDING],
    ['paddingX', PADDING_X],
    ['paddingY', PADDING_Y],
    ['margin', MARGIN],
    ['marginX', MARGIN_X],
    ['marginY', MARGIN_Y],
  ])('%s', (prop, table) => {
    it.each(SPACING_TOKENS)('maps %s to its class', async (token) => {
      await render(<Box testID={TEST_ID} {...{ [prop]: token }} />);

      expect(renderedClasses()).toStrictEqual([table[token]]);
    });
  });

  it.each(SURFACES)('maps surface %s to its background class', async (surface) => {
    await render(<Box testID={TEST_ID} surface={surface} />);

    expect(renderedClasses()).toStrictEqual([SURFACE[surface]]);
  });

  it.each(RADII)('maps radius %s to its rounded class', async (radius) => {
    await render(<Box testID={TEST_ID} radius={radius} />);

    expect(renderedClasses()).toStrictEqual([RADIUS[radius]]);
  });

  it('fills its parent with flex', async () => {
    await render(<Box testID={TEST_ID} flex />);

    expect(renderedClasses()).toStrictEqual(['flex-1']);
  });

  it('draws a border in the border color when bordered', async () => {
    await render(<Box testID={TEST_ID} bordered />);

    expect(renderedClasses()).toStrictEqual(['border', 'border-border']);
  });

  it('combines every token prop', async () => {
    await render(
      <Box
        testID={TEST_ID}
        flex
        padding="lg"
        paddingX="xl"
        paddingY="xs"
        margin="sm"
        marginX="md"
        marginY="2xl"
        surface="surfaceMuted"
        radius="md"
        bordered
      />,
    );

    expect(renderedClasses()).toStrictEqual([
      'flex-1',
      'p-lg',
      'px-xl',
      'py-xs',
      'm-sm',
      'mx-md',
      'my-2xl',
      'bg-surface-muted',
      'rounded-md',
      'border',
      'border-border',
    ]);
  });

  it('accepts spacing tokens only: a raw number is a type error and adds no class', async () => {
    // @ts-expect-error(F-05): raw numbers are not spacing tokens
    await render(<Box testID={TEST_ID} padding={16} margin={8} />);

    expect(renderedClasses()).toStrictEqual([]);
  });
});
