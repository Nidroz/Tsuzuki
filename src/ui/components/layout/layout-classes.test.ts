import { describe, expect, it } from '@jest/globals';

import { radii } from '../../theme/radii';
import { spacing } from '../../theme/spacing';
import {
  ALIGN,
  cx,
  GAP,
  JUSTIFY,
  MARGIN,
  MARGIN_X,
  MARGIN_Y,
  PADDING,
  PADDING_X,
  PADDING_Y,
  RADIUS,
  SQUARE,
  SURFACE,
} from './layout-classes';

const SPACING_TOKENS = Object.keys(spacing);
const RADIUS_TOKENS = Object.keys(radii);

// the tailwind scale keys are the token names (tailwind.config.ts), so every class ends with its token
describe('spacing class tables', () => {
  it.each([
    ['PADDING', PADDING, 'p'],
    ['PADDING_X', PADDING_X, 'px'],
    ['PADDING_Y', PADDING_Y, 'py'],
    ['MARGIN', MARGIN, 'm'],
    ['MARGIN_X', MARGIN_X, 'mx'],
    ['MARGIN_Y', MARGIN_Y, 'my'],
    ['GAP', GAP, 'gap'],
  ])('%s maps every spacing token to its %s- class', (_name, table, prefix) => {
    expect(Object.keys(table)).toStrictEqual(SPACING_TOKENS);
    for (const token of SPACING_TOKENS) {
      expect(table[token as keyof typeof table]).toBe(`${prefix}-${token}`);
    }
  });

  it('SQUARE maps every spacing token to a square of that size', () => {
    expect(Object.keys(SQUARE)).toStrictEqual(SPACING_TOKENS);
    for (const token of SPACING_TOKENS) {
      expect(SQUARE[token as keyof typeof SQUARE]).toBe(`h-${token} w-${token}`);
    }
  });
});

describe('RADIUS', () => {
  it('maps every radius token to its rounded- class', () => {
    expect(Object.keys(RADIUS)).toStrictEqual(RADIUS_TOKENS);
    for (const token of RADIUS_TOKENS) {
      expect(RADIUS[token as keyof typeof RADIUS]).toBe(`rounded-${token}`);
    }
  });
});

describe('SURFACE', () => {
  it('maps each surface token to its kebab-case background class', () => {
    expect(SURFACE).toStrictEqual({
      background: 'bg-background',
      surface: 'bg-surface',
      surfaceMuted: 'bg-surface-muted',
    });
  });
});

describe('ALIGN and JUSTIFY', () => {
  it('map alignment tokens to flexbox classes', () => {
    expect(ALIGN).toStrictEqual({
      start: 'items-start',
      center: 'items-center',
      end: 'items-end',
      stretch: 'items-stretch',
    });
    expect(JUSTIFY).toStrictEqual({
      start: 'justify-start',
      center: 'justify-center',
      end: 'justify-end',
      between: 'justify-between',
      around: 'justify-around',
    });
  });
});

describe('cx', () => {
  it('joins the classes that are set with single spaces', () => {
    expect(cx('a', 'b c', 'd')).toBe('a b c d');
  });

  it('skips false, undefined and empty strings', () => {
    expect(cx(false, 'a', undefined, '', 'b', false)).toBe('a b');
  });

  it('returns an empty string when nothing is set', () => {
    expect(cx()).toBe('');
    expect(cx(false, undefined)).toBe('');
  });
});
