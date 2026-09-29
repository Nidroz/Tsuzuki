import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { textVariants, type TextVariant } from '../theme/typography';
import { Text, type TextAlign, type TextTone } from './Text';

const TEST_ID = 'text';
const CONTENT = 'Hello';
const VARIANTS = Object.keys(textVariants) as TextVariant[];

const TONE_CLASSES: Record<TextTone, string> = {
  default: 'text-text',
  muted: 'text-text-muted',
  primary: 'text-primary',
  danger: 'text-danger',
  onPrimary: 'text-on-primary',
  onDanger: 'text-on-danger',
};

const ALIGN_CLASSES: Record<TextAlign, string> = {
  start: 'text-left',
  center: 'text-center',
  end: 'text-right',
};

const renderedClasses = () => classesOf(screen.getByTestId(TEST_ID));

describe('Text', () => {
  it('renders its children as body text in the default tone', async () => {
    await render(<Text testID={TEST_ID}>{CONTENT}</Text>);

    expect(screen.getByText(CONTENT)).toBeOnTheScreen();
    expect(renderedClasses()).toStrictEqual(['text-body', 'text-text']);
    expect(screen.getByTestId(TEST_ID)).toHaveProp('accessibilityRole', 'text');
  });

  it.each(VARIANTS)('maps variant %s to its typography class', async (variant) => {
    await render(
      <Text variant={variant} testID={TEST_ID}>
        {CONTENT}
      </Text>,
    );

    expect(renderedClasses()[0]).toBe(`text-${variant}`);
  });

  it('announces the title variant as a heading', async () => {
    await render(<Text variant="title">{CONTENT}</Text>);

    expect(screen.getByRole('header', { name: CONTENT })).toBeOnTheScreen();
  });

  it.each(VARIANTS.filter((variant) => variant !== 'title'))(
    'does not announce variant %s as a heading',
    async (variant) => {
      await render(<Text variant={variant}>{CONTENT}</Text>);

      expect(screen.queryByRole('header')).not.toBeOnTheScreen();
      expect(screen.getByRole('text', { name: CONTENT })).toBeOnTheScreen();
    },
  );

  it.each(Object.entries(TONE_CLASSES) as [TextTone, string][])(
    'maps tone %s to %s',
    async (tone, className) => {
      await render(
        <Text tone={tone} testID={TEST_ID}>
          {CONTENT}
        </Text>,
      );

      expect(renderedClasses()).toStrictEqual(['text-body', className]);
    },
  );

  it.each(Object.entries(ALIGN_CLASSES) as [TextAlign, string][])(
    'maps align %s to %s',
    async (align, className) => {
      await render(
        <Text align={align} testID={TEST_ID}>
          {CONTENT}
        </Text>,
      );

      expect(renderedClasses()).toStrictEqual(['text-body', 'text-text', className]);
    },
  );

  it('truncates after numberOfLines when given', async () => {
    await render(
      <Text numberOfLines={2} testID={TEST_ID}>
        {CONTENT}
      </Text>,
    );

    expect(screen.getByTestId(TEST_ID)).toHaveProp('numberOfLines', 2);
  });

  it('does not truncate by default', async () => {
    await render(<Text testID={TEST_ID}>{CONTENT}</Text>);

    expect(screen.getByTestId(TEST_ID).props).not.toHaveProperty('numberOfLines');
    expect(screen.getByTestId(TEST_ID).props).not.toHaveProperty('accessibilityLabel');
  });

  it('replaces the text for screen readers with accessibilityLabel', async () => {
    await render(<Text accessibilityLabel="More pages">…</Text>);

    expect(screen.getByLabelText('More pages')).toHaveTextContent('…');
    expect(screen.getByRole('text', { name: 'More pages' })).toBeOnTheScreen();
  });
});
