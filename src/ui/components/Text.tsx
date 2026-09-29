import type { ReactNode } from 'react';
import { Text as NativeText } from 'react-native';

import type { TextVariant } from '../theme/typography';
import { cx } from './layout/layout-classes';

export type TextTone = 'default' | 'muted' | 'primary' | 'danger' | 'onPrimary' | 'onDanger';
export type TextAlign = 'start' | 'center' | 'end';

// size, line height and weight of each variant come from the typography tokens (text-<variant>)
const VARIANT: Readonly<Record<TextVariant, string>> = {
  title: 'text-title',
  subtitle: 'text-subtitle',
  body: 'text-body',
  label: 'text-label',
  caption: 'text-caption',
};

const TONE: Readonly<Record<TextTone, string>> = {
  default: 'text-text',
  muted: 'text-text-muted',
  primary: 'text-primary',
  danger: 'text-danger',
  onPrimary: 'text-on-primary',
  onDanger: 'text-on-danger',
};

const ALIGN: Readonly<Record<TextAlign, string>> = {
  start: 'text-left',
  center: 'text-center',
  end: 'text-right',
};

export interface TextProps {
  /** translated text: src/ui never translates */
  children: ReactNode;
  /** body by default; title is announced as a heading */
  variant?: TextVariant;
  tone?: TextTone;
  align?: TextAlign;
  /** truncates with an ellipsis after this many lines */
  numberOfLines?: number;
  /** replaces the text for screen readers, e.g. for a symbol */
  accessibilityLabel?: string;
  testID?: string;
}

/** themed text; scales with the system font size */
export function Text({
  children,
  variant = 'body',
  tone = 'default',
  align,
  numberOfLines,
  accessibilityLabel,
  testID,
}: TextProps) {
  return (
    <NativeText
      className={cx(VARIANT[variant], TONE[tone], align && ALIGN[align])}
      accessibilityRole={variant === 'title' ? 'header' : 'text'}
      {...(numberOfLines !== undefined && { numberOfLines })}
      {...(accessibilityLabel !== undefined && { accessibilityLabel })}
      testID={testID}
    >
      {children}
    </NativeText>
  );
}
