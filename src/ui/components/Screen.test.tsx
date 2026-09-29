import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { spacing, type SpacingToken } from '../theme/spacing';
import { PADDING } from './layout/layout-classes';
import { Screen } from './Screen';

const TEST_ID = 'screen';
const CONTENT = 'screen content';
const SAFE_AREA_HOST = 'RNCSafeAreaView';
const SCROLL_VIEW_HOST = 'RCTScrollView';
const SPACING_TOKENS = Object.keys(spacing) as SpacingToken[];

// the only child of the safe area: the scroll view or the plain content view
const contentContainer = () => {
  const [child] = screen.getByTestId(TEST_ID).children;
  if (child === undefined || typeof child === 'string') {
    throw new Error('the screen renders no content container');
  }
  return child;
};

describe('Screen', () => {
  it('renders its children inside a safe area view that carries the testID', async () => {
    await render(
      <Screen testID={TEST_ID}>
        <Text>{CONTENT}</Text>
      </Screen>,
    );

    const root = screen.getByTestId(TEST_ID);

    expect(root.type).toBe(SAFE_AREA_HOST);
    expect(root).toContainElement(screen.getByText(CONTENT));
  });

  it('insets all four safe area edges by default', async () => {
    await render(<Screen testID={TEST_ID} />);

    expect(screen.getByTestId(TEST_ID)).toHaveProp('edges', {
      top: 'additive',
      right: 'additive',
      bottom: 'additive',
      left: 'additive',
    });
  });

  it('insets the given edges only', async () => {
    await render(<Screen testID={TEST_ID} edges={['top', 'bottom']} />);

    expect(screen.getByTestId(TEST_ID)).toHaveProp('edges', {
      top: 'additive',
      right: 'off',
      bottom: 'additive',
      left: 'off',
    });
  });

  it('renders a plain view with lg padding by default, not a scroll view', async () => {
    await render(
      <Screen testID={TEST_ID}>
        <Text>{CONTENT}</Text>
      </Screen>,
    );

    const content = contentContainer();

    expect(content.type).not.toBe(SCROLL_VIEW_HOST);
    expect(classesOf(content)).toStrictEqual(['flex-1', PADDING.lg]);
    expect(content).toContainElement(screen.getByText(CONTENT));
  });

  it.each(SPACING_TOKENS)('maps padding %s to its class', async (padding) => {
    await render(<Screen testID={TEST_ID} padding={padding} />);

    expect(classesOf(contentContainer())).toStrictEqual(['flex-1', PADDING[padding]]);
  });

  it('scrolls its content in the scroll variant, keeping taps while the keyboard is open', async () => {
    await render(
      <Screen testID={TEST_ID} scroll padding="sm">
        <Text>{CONTENT}</Text>
      </Screen>,
    );

    const scrollView = contentContainer();

    expect(scrollView.type).toBe(SCROLL_VIEW_HOST);
    expect(classesOf(scrollView)).toStrictEqual(['flex-1']);
    expect(classesOf(scrollView, 'contentContainerClassName')).toStrictEqual(['grow', PADDING.sm]);
    expect(scrollView).toHaveProp('keyboardShouldPersistTaps', 'handled');
    expect(scrollView).toContainElement(screen.getByText(CONTENT));
  });

  it('renders without children', async () => {
    await render(<Screen testID={TEST_ID} />);

    expect(contentContainer()).toBeEmptyElement();
  });
});
