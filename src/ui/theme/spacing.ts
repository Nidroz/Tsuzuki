// spacing scale in density-independent pixels: padding, margin, gap and spacer sizes
export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
} as const;

export type SpacingToken = keyof typeof spacing;
