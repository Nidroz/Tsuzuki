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

// react native swaps textAlign left and right in right-to-left layouts, whatever
// I18nManager.doLeftAndRightSwapInRTL says (that flag covers layout edges): the ios text layout
// (RCTAttributedTextUtils.mm) and the android one (TextLayoutManager.kt) align "left" to the start
// of the paragraph, so start and end hold
const ALIGN: Readonly<Record<TextAlign, string>> = {
  start: 'text-left',
  center: 'text-center',
  end: 'text-right',
};

// ios and android each have their own flag; no-hide-descendants also hides nested texts
const HIDDEN_FROM_SCREEN_READERS = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

export interface TextProps {
  /** translated text: src/ui never translates */
  children: ReactNode;
  /** body by default; title is announced as a heading */
  variant?: TextVariant;
  /** announces the text as a heading whatever its variant, e.g. a section title */
  heading?: boolean;
  tone?: TextTone;
  align?: TextAlign;
  /** truncates with an ellipsis after this many lines */
  numberOfLines?: number;
  /** replaces the text for screen readers, e.g. for a symbol */
  accessibilityLabel?: string;
  /**
   * hides the text from screen readers, which then read it once: for a visible text another
   * element already announces, e.g. the caption of a spinner labelled with the same sentence
   */
  accessibilityHidden?: boolean;
  testID?: string;
}

/** themed text; scales with the system font size */
export function Text({
  children,
  variant = 'body',
  heading = false,
  tone = 'default',
  align,
  numberOfLines,
  accessibilityLabel,
  accessibilityHidden = false,
  testID,
}: TextProps) {
  return (
    <NativeText
      className={cx(VARIANT[variant], TONE[tone], align && ALIGN[align])}
      accessibilityRole={heading || variant === 'title' ? 'header' : 'text'}
      {...(numberOfLines !== undefined && { numberOfLines })}
      {...(accessibilityLabel !== undefined && { accessibilityLabel })}
      {...(accessibilityHidden && HIDDEN_FROM_SCREEN_READERS)}
      testID={testID}
    >
      {children}
    </NativeText>
  );
}
