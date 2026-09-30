import { describe, expect, it } from '@jest/globals';

import { radii } from './radii';
import { ICON_SIZE, opacities, TOUCH_TARGET } from './sizes';
import { spacing } from './spacing';
import { fontWeights, textVariants } from './typography';

// the scales grow with their order: a token further in the scale is never smaller
const isAscending = (values: readonly number[]) =>
  values.every((value, index) => index === 0 || value > (values[index - 1] ?? value));

const GRID = 4;
const MIN_TOUCH_TARGET = 44;
const MIN_READABLE_FONT_SIZE = 12;

describe('spacing', () => {
  it('starts at none and grows on a 4dp grid', () => {
    const values = Object.values(spacing);

    expect(spacing.none).toBe(0);
    expect(isAscending(values)).toBe(true);
    expect(values.filter((value) => value % GRID !== 0)).toStrictEqual([]);
  });
});

describe('radii', () => {
  it('starts at none, grows, and ends with a full radius for pills', () => {
    expect(radii.none).toBe(0);
    expect(isAscending(Object.values(radii))).toBe(true);
    expect(radii.full).toBeGreaterThanOrEqual(TOUCH_TARGET);
  });
});

describe('sizes', () => {
  it('gives pressables a touch target of at least 44', () => {
    expect(TOUCH_TARGET).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it('fits the icon inside the touch target', () => {
    expect(ICON_SIZE).toBeGreaterThan(0);
    expect(ICON_SIZE).toBeLessThanOrEqual(TOUCH_TARGET);
  });

  it('keeps opacities between 0 and 1, pressed lighter than disabled', () => {
    for (const opacity of Object.values(opacities)) {
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThan(1);
    }
    expect(opacities.pressed).toBeGreaterThan(opacities.disabled);
  });
});

describe('typography', () => {
  it('maps font weights to css weights', () => {
    expect(fontWeights).toStrictEqual({
      regular: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    });
  });

  it.each(Object.entries(textVariants))(
    '%s is readable: at least 12dp, line height at least its size, a known weight',
    (_variant, style) => {
      expect(style.fontSize).toBeGreaterThanOrEqual(MIN_READABLE_FONT_SIZE);
      expect(style.lineHeight).toBeGreaterThanOrEqual(style.fontSize);
      expect(Object.keys(fontWeights)).toContain(style.fontWeight);
    },
  );

  it('orders the headline variants by size', () => {
    expect(textVariants.title.fontSize).toBeGreaterThan(textVariants.subtitle.fontSize);
    expect(textVariants.subtitle.fontSize).toBeGreaterThan(textVariants.body.fontSize);
    expect(textVariants.body.fontSize).toBeGreaterThan(textVariants.caption.fontSize);
  });
});
