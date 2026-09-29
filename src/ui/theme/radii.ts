// corner radii in density-independent pixels; full makes pills and circles
export const radii = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  full: 9999,
} as const;

export type RadiusToken = keyof typeof radii;
