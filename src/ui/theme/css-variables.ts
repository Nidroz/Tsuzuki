import { COLOR_TOKENS, type ColorToken, type Palette } from './colors';

// the palette reaches tailwind classes through css variables: tailwind.config.ts maps each color to
// rgb(var(--color-<name>) / <alpha-value>) and ThemeProvider sets the variables of the active
// scheme with nativewind vars()

const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX_RADIX = 16;
const UPPERCASE = /[A-Z]/g;

/** tailwind color key of a token: surfaceMuted -> surface-muted (class bg-surface-muted) */
export const colorClassKey = (token: ColorToken): string =>
  token.replace(UPPERCASE, (letter) => `-${letter.toLowerCase()}`);

/** css variable holding a token's channels: surfaceMuted -> --color-surface-muted */
export const colorVariable = (token: ColorToken): string => `--color-${colorClassKey(token)}`;

/** space-separated rgb channels of a #rrggbb color, the form rgb(var(--x) / alpha) expects */
export const toRgbChannels = (hex: string): string => {
  const match = HEX_COLOR.exec(hex);
  if (!match) {
    throw new Error(`expected a #rrggbb color, got "${hex}"`);
  }
  return match
    .slice(1)
    .map((channel) => String(Number.parseInt(channel, HEX_RADIX)))
    .join(' ');
};

/** css variables of a palette, e.g. { '--color-background': '248 250 252', ... } */
export const paletteVariables = (palette: Palette): Record<string, string> =>
  Object.fromEntries(
    COLOR_TOKENS.map((token) => [colorVariable(token), toRgbChannels(palette[token])]),
  );
