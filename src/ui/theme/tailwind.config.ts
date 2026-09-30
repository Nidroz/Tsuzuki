import type { Config } from 'tailwindcss';
import nativewindPreset from 'nativewind/preset';

import { COLOR_TOKENS } from './colors';
import { colorClassKey, colorVariable } from './css-variables';
import { radii } from './radii';
import { opacities, TOUCH_TARGET } from './sizes';
import { spacing } from './spacing';
import { fontWeights, textVariants } from './typography';

// the scales below replace tailwind's defaults (theme, not theme.extend): only design tokens exist
// as classes (bg-surface-muted, p-lg, rounded-md, text-title), so a raw value cannot slip in.
// lengths are written in px: nativewind reads rem as 14px on native, px maps 1:1 to dp
const px = (value: number) => `${String(value)}px`;

const mapValues = <K extends string, V, R>(record: Readonly<Record<K, V>>, map: (value: V) => R) =>
  Object.fromEntries(Object.entries<V>(record).map(([key, value]) => [key, map(value)]));

const colors = Object.fromEntries(
  COLOR_TOKENS.map((token) => [
    colorClassKey(token),
    `rgb(var(${colorVariable(token)}) / <alpha-value>)`,
  ]),
);

type FontSizeEntry = [fontSize: string, configuration: { lineHeight: string; fontWeight: string }];

const fontSize = mapValues(
  textVariants,
  ({ fontSize: size, lineHeight, fontWeight }): FontSizeEntry => [
    px(size),
    { lineHeight: px(lineHeight), fontWeight: fontWeights[fontWeight] },
  ],
);

// tailwind scans only src/ui: className is used nowhere else (CONTRIBUTING.md section 4)
const config = {
  content: ['./src/ui/**/*.{ts,tsx}'],
  presets: [nativewindPreset],
  // the color scheme is set manually from the user's preference (ThemeProvider); the palette
  // switches through css variables, so no dark: variant is needed
  darkMode: 'class',
  theme: {
    colors: { transparent: 'transparent', ...colors },
    spacing: mapValues(spacing, px),
    borderRadius: mapValues(radii, px),
    fontSize,
    fontWeight: fontWeights,
    opacity: mapValues(opacities, String),
    extend: {
      minHeight: { touch: px(TOUCH_TARGET) },
      minWidth: { touch: px(TOUCH_TARGET) },
    },
  },
} satisfies Config;

// tailwind loads its config from the default export
export default config;
