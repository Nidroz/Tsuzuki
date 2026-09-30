import { describe, expect, it } from '@jest/globals';

import { COLOR_TOKENS } from './colors';
import { colorClassKey, colorVariable } from './css-variables';
import { radii } from './radii';
import { opacities, TOUCH_TARGET } from './sizes';
import { spacing } from './spacing';
import config from './tailwind.config';
import { fontWeights, textVariants } from './typography';

const px = (value: number) => `${String(value)}px`;

// the tailwind scales are generated from the tokens: only design tokens exist as classes
describe('tailwind config', () => {
  it('scans src/ui only, the one layer that uses className', () => {
    expect(config.content).toStrictEqual(['./src/ui/**/*.{ts,tsx}']);
  });

  it('replaces the default scales instead of extending them', () => {
    expect(Object.keys(config.theme.extend)).toStrictEqual(['minHeight', 'minWidth']);
  });

  it('maps every color token to its css variable, plus transparent', () => {
    const expected = Object.fromEntries(
      COLOR_TOKENS.map((token) => [
        colorClassKey(token),
        `rgb(var(${colorVariable(token)}) / <alpha-value>)`,
      ]),
    );

    expect(config.theme.colors).toStrictEqual({ transparent: 'transparent', ...expected });
  });

  it('writes the spacing and radius tokens in px', () => {
    expect(config.theme.spacing).toStrictEqual(
      Object.fromEntries(Object.entries(spacing).map(([token, value]) => [token, px(value)])),
    );
    expect(config.theme.borderRadius).toStrictEqual(
      Object.fromEntries(Object.entries(radii).map(([token, value]) => [token, px(value)])),
    );
  });

  it('gives each text variant its size, line height and weight', () => {
    for (const [variant, style] of Object.entries(textVariants)) {
      expect(config.theme.fontSize[variant]).toStrictEqual([
        px(style.fontSize),
        { lineHeight: px(style.lineHeight), fontWeight: fontWeights[style.fontWeight] },
      ]);
    }
    expect(Object.keys(config.theme.fontSize)).toStrictEqual(Object.keys(textVariants));
    expect(config.theme.fontWeight).toBe(fontWeights);
  });

  it('exposes the opacity tokens and the touch target', () => {
    expect(config.theme.opacity).toStrictEqual({
      disabled: String(opacities.disabled),
      pressed: String(opacities.pressed),
    });
    expect(config.theme.extend.minHeight).toStrictEqual({ touch: px(TOUCH_TARGET) });
    expect(config.theme.extend.minWidth).toStrictEqual({ touch: px(TOUCH_TARGET) });
  });
});
