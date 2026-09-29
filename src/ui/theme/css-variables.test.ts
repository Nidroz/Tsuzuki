import { describe, expect, it } from '@jest/globals';

import { COLOR_TOKENS, type ColorToken, palettes } from './colors';
import { colorClassKey, colorVariable, paletteVariables, toRgbChannels } from './css-variables';

describe('colorClassKey', () => {
  it.each<[ColorToken, string]>([
    ['background', 'background'],
    ['surfaceMuted', 'surface-muted'],
    ['textMuted', 'text-muted'],
    ['onPrimary', 'on-primary'],
    ['onDanger', 'on-danger'],
  ])('turns %s into %s', (token, key) => {
    expect(colorClassKey(token)).toBe(key);
  });
});

describe('colorVariable', () => {
  it('prefixes the class key with --color-', () => {
    expect(colorVariable('surfaceMuted')).toBe('--color-surface-muted');
    expect(colorVariable('text')).toBe('--color-text');
  });

  it('gives every token its own variable', () => {
    expect(new Set(COLOR_TOKENS.map(colorVariable)).size).toBe(COLOR_TOKENS.length);
  });
});

describe('toRgbChannels', () => {
  it.each([
    ['#000000', '0 0 0'],
    ['#FFFFFF', '255 255 255'],
    ['#ffffff', '255 255 255'],
    ['#F8FAFC', '248 250 252'],
    ['#4338CA', '67 56 202'],
  ])('turns %s into "%s"', (hex, channels) => {
    expect(toRgbChannels(hex)).toBe(channels);
  });

  it.each(['', 'F8FAFC', '#FFF', '#F8FAFC80', '#GGGGGG', 'rgb(0, 0, 0)', ' #F8FAFC'])(
    'rejects %p',
    (hex) => {
      expect(() => toRgbChannels(hex)).toThrow(`expected a #rrggbb color, got "${hex}"`);
    },
  );
});

describe('paletteVariables', () => {
  it('maps every token of a palette to its variable and rgb channels', () => {
    const variables = paletteVariables(palettes.light);

    expect(Object.keys(variables)).toStrictEqual(COLOR_TOKENS.map(colorVariable));
    expect(variables['--color-background']).toBe('248 250 252');
    expect(variables['--color-surface-muted']).toBe(toRgbChannels(palettes.light.surfaceMuted));
  });

  it('gives the light and dark palettes the same variables with their own values', () => {
    const light = paletteVariables(palettes.light);
    const dark = paletteVariables(palettes.dark);

    expect(Object.keys(dark)).toStrictEqual(Object.keys(light));
    expect(dark['--color-text']).toBe(toRgbChannels(palettes.dark.text));
    expect(dark['--color-text']).not.toBe(light['--color-text']);
  });
});
