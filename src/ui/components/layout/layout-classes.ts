import type { RadiusToken } from '../../theme/radii';
import type { SpacingToken } from '../../theme/spacing';

// token -> class lookup tables. tailwind finds classes by scanning the source for literal strings,
// so every class is written out in full here: a class built by interpolation would never be
// generated

export type SurfaceToken = 'background' | 'surface' | 'surfaceMuted';
export type AlignToken = 'start' | 'center' | 'end' | 'stretch';
export type JustifyToken = 'start' | 'center' | 'end' | 'between' | 'around';

type SpacingClasses = Readonly<Record<SpacingToken, string>>;

export const PADDING: SpacingClasses = {
  none: 'p-none',
  xs: 'p-xs',
  sm: 'p-sm',
  md: 'p-md',
  lg: 'p-lg',
  xl: 'p-xl',
  '2xl': 'p-2xl',
};

export const PADDING_X: SpacingClasses = {
  none: 'px-none',
  xs: 'px-xs',
  sm: 'px-sm',
  md: 'px-md',
  lg: 'px-lg',
  xl: 'px-xl',
  '2xl': 'px-2xl',
};

export const PADDING_Y: SpacingClasses = {
  none: 'py-none',
  xs: 'py-xs',
  sm: 'py-sm',
  md: 'py-md',
  lg: 'py-lg',
  xl: 'py-xl',
  '2xl': 'py-2xl',
};

export const MARGIN: SpacingClasses = {
  none: 'm-none',
  xs: 'm-xs',
  sm: 'm-sm',
  md: 'm-md',
  lg: 'm-lg',
  xl: 'm-xl',
  '2xl': 'm-2xl',
};

export const MARGIN_X: SpacingClasses = {
  none: 'mx-none',
  xs: 'mx-xs',
  sm: 'mx-sm',
  md: 'mx-md',
  lg: 'mx-lg',
  xl: 'mx-xl',
  '2xl': 'mx-2xl',
};

export const MARGIN_Y: SpacingClasses = {
  none: 'my-none',
  xs: 'my-xs',
  sm: 'my-sm',
  md: 'my-md',
  lg: 'my-lg',
  xl: 'my-xl',
  '2xl': 'my-2xl',
};

export const GAP: SpacingClasses = {
  none: 'gap-none',
  xs: 'gap-xs',
  sm: 'gap-sm',
  md: 'gap-md',
  lg: 'gap-lg',
  xl: 'gap-xl',
  '2xl': 'gap-2xl',
};

// a square: the spacer takes its size along the main axis of both a Stack and a Row
export const SQUARE: SpacingClasses = {
  none: 'h-none w-none',
  xs: 'h-xs w-xs',
  sm: 'h-sm w-sm',
  md: 'h-md w-md',
  lg: 'h-lg w-lg',
  xl: 'h-xl w-xl',
  '2xl': 'h-2xl w-2xl',
};

export const SURFACE: Readonly<Record<SurfaceToken, string>> = {
  background: 'bg-background',
  surface: 'bg-surface',
  surfaceMuted: 'bg-surface-muted',
};

export const RADIUS: Readonly<Record<RadiusToken, string>> = {
  none: 'rounded-none',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
};

export const ALIGN: Readonly<Record<AlignToken, string>> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
};

export const JUSTIFY: Readonly<Record<JustifyToken, string>> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
  around: 'justify-around',
};

/** joins the classes that are set, skipping false and undefined */
export const cx = (...classes: ReadonlyArray<string | false | undefined>): string =>
  classes.filter((value): value is string => typeof value === 'string' && value !== '').join(' ');
