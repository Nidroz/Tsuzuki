import { describe, expect, it } from '@jest/globals';

import { COLOR_TOKENS, type ColorScheme, type ColorToken, palettes } from './colors';

const SCHEMES = Object.keys(palettes) as ColorScheme[];
const HEX_COLOR = /^#[0-9A-F]{6}$/u;

// contrast thresholds of WCAG 2.1: normal text (AA) and non-text UI components (input boundaries, focus ring)
const TEXT_CONTRAST = 4.5;
const UI_CONTRAST = 3;
const SURFACES: ColorToken[] = ['background', 'surface', 'surfaceMuted'];
const TEXT_TOKENS: ColorToken[] = ['text', 'textMuted', 'primary', 'danger'];
const UI_TOKENS: ColorToken[] = ['border', 'focus'];
const ON_COLORS: [ColorToken, ColorToken][] = [
  ['onPrimary', 'primary'],
  ['onDanger', 'danger'],
];

// relative luminance and contrast ratio, as defined by WCAG 2.1
const channelLuminance = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((start) =>
    channelLuminance(Number.parseInt(hex.slice(start, start + 2), 16)),
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrast = (first: string, second: string): number => {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
};

const pairs = (foregrounds: ColorToken[], backgrounds: ColorToken[]) =>
  SCHEMES.flatMap((scheme) =>
    foregrounds.flatMap((foreground) =>
      backgrounds.map((background) => [scheme, foreground, background] as const),
    ),
  );

describe('contrast helper', () => {
  it('matches the reference ratios of black, white and grey', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });
});

describe('palettes', () => {
  it('has a light and a dark palette', () => {
    expect(SCHEMES).toStrictEqual(['light', 'dark']);
  });

  it.each(SCHEMES)('%s defines exactly the color tokens', (scheme) => {
    expect(Object.keys(palettes[scheme]).sort()).toStrictEqual([...COLOR_TOKENS].sort());
  });

  it.each(SCHEMES)('%s uses #RRGGBB colors only', (scheme) => {
    for (const token of COLOR_TOKENS) {
      expect({ token, color: palettes[scheme][token] }).toStrictEqual({
        token,
        color: expect.stringMatching(HEX_COLOR),
      });
    }
  });

  it('lists every token once', () => {
    expect(new Set(COLOR_TOKENS).size).toBe(COLOR_TOKENS.length);
  });

  it.each(pairs(TEXT_TOKENS, SURFACES))(
    '%s: %s text on %s reaches 4.5:1',
    (scheme, foreground, background) => {
      const palette = palettes[scheme];

      expect(contrast(palette[foreground], palette[background])).toBeGreaterThanOrEqual(
        TEXT_CONTRAST,
      );
    },
  );

  it.each(pairs(UI_TOKENS, SURFACES))(
    '%s: %s on %s reaches the 3:1 of UI components',
    (scheme, foreground, background) => {
      const palette = palettes[scheme];

      expect(contrast(palette[foreground], palette[background])).toBeGreaterThanOrEqual(
        UI_CONTRAST,
      );
    },
  );

  it.each(SCHEMES.flatMap((scheme) => ON_COLORS.map(([on, fill]) => [scheme, on, fill] as const)))(
    '%s: %s text on %s reaches 4.5:1',
    (scheme, foreground, background) => {
      const palette = palettes[scheme];

      expect(contrast(palette[foreground], palette[background])).toBeGreaterThanOrEqual(
        TEXT_CONTRAST,
      );
    },
  );
});
