import { describe, expect, it } from '@jest/globals';

import { COLOR_TOKENS, type ColorScheme, type ColorToken, palettes } from './colors';
import { opacities } from './sizes';

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

// a color as its sRGB channels (0 to 255), a composited one possibly fractional
type Channels = readonly number[];

const channelsOf = (hex: string): Channels =>
  [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));

const luminance = (channels: Channels): number => {
  const [red = 0, green = 0, blue = 0] = channels.map(channelLuminance);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const channelContrast = (first: Channels, second: Channels): number => {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
};

const contrast = (first: string, second: string): number =>
  channelContrast(channelsOf(first), channelsOf(second));

// a color drawn at an opacity over a background, blended channel by channel in sRGB
const composite = (color: string, opacity: number, background: string): Channels => {
  const backgroundChannels = channelsOf(background);
  return channelsOf(color).map(
    (channel, index) => channel * opacity + (backgroundChannels[index] ?? 0) * (1 - opacity),
  );
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

  it('composites a color at an opacity over a background', () => {
    expect(composite('#000000', 0.5, '#FFFFFF')).toStrictEqual([127.5, 127.5, 127.5]);
    expect(composite('#000000', 0, '#F8FAFC')).toStrictEqual(channelsOf('#F8FAFC'));
    expect(composite('#000000', 1, '#F8FAFC')).toStrictEqual([0, 0, 0]);
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

  // a sheet is a surface panel with a border top edge over the scrim: either one stands out from
  // the dimmed screen with the 3:1 of UI components
  it.each(SCHEMES.flatMap((scheme) => SURFACES.map((surface) => [scheme, surface] as const)))(
    '%s: the sheet edge reaches 3:1 against %s dimmed by the scrim',
    (scheme, surface) => {
      const palette = palettes[scheme];
      const dimmed = composite(palette.scrim, opacities.scrim, palette[surface]);
      const edge = Math.max(
        channelContrast(channelsOf(palette.surface), dimmed),
        channelContrast(channelsOf(palette.border), dimmed),
      );

      expect(edge).toBeGreaterThanOrEqual(UI_CONTRAST);
    },
  );
});
