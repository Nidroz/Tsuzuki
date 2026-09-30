// font weights and text variants. sizes and line heights are in density-independent pixels: react
// native scales them with the system font size (allowFontScaling stays on)
export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export type FontWeightToken = keyof typeof fontWeights;

interface TextVariantStyle {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontWeight: FontWeightToken;
}

export const textVariants = {
  title: { fontSize: 24, lineHeight: 32, fontWeight: 'bold' },
  subtitle: { fontSize: 18, lineHeight: 24, fontWeight: 'semibold' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: 'regular' },
  // button, chip and field labels
  label: { fontSize: 16, lineHeight: 24, fontWeight: 'semibold' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: 'regular' },
} as const satisfies Record<string, TextVariantStyle>;

export type TextVariant = keyof typeof textVariants;
