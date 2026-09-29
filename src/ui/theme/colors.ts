// semantic color tokens, one palette per color scheme. contrast ratios (WCAG 2.1) were checked for
// both palettes: text, textMuted, primary and danger reach AA (4.5:1) on background, surface and
// surfaceMuted; onPrimary on primary and onDanger on danger reach AA; border and focus reach the
// 3:1 of non-text UI components (input boundaries, focus ring) on every surface
export const COLOR_TOKENS = [
  'background',
  'surface',
  'surfaceMuted',
  'text',
  'textMuted',
  'primary',
  'onPrimary',
  'border',
  'danger',
  'onDanger',
  'focus',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

export type ColorScheme = 'light' | 'dark';

/** hex colors (#rrggbb) by token */
export type Palette = Readonly<Record<ColorToken, string>>;

const light: Palette = {
  background: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F5F9',
  text: '#0F172A',
  textMuted: '#475569',
  primary: '#4338CA',
  onPrimary: '#FFFFFF',
  border: '#64748B',
  danger: '#B91C1C',
  onDanger: '#FFFFFF',
  focus: '#2563EB',
};

const dark: Palette = {
  background: '#020617',
  surface: '#0F172A',
  surfaceMuted: '#1E293B',
  text: '#F1F5F9',
  textMuted: '#94A3B8',
  primary: '#A5B4FC',
  onPrimary: '#1E1B4B',
  border: '#64748B',
  danger: '#FCA5A5',
  onDanger: '#450A0A',
  focus: '#60A5FA',
};

export const palettes: Readonly<Record<ColorScheme, Palette>> = { light, dark };
