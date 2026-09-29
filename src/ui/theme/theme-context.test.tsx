import { describe, expect, it } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { palettes } from './colors';
import {
  MISSING_THEME_PROVIDER_MESSAGE,
  ThemeContext,
  type ThemeContextValue,
  useThemeColors,
} from './theme-context';

const DARK_THEME: ThemeContextValue = { scheme: 'dark', colors: palettes.dark };

function DarkContext({ children }: { children: ReactNode }) {
  return <ThemeContext value={DARK_THEME}>{children}</ThemeContext>;
}

describe('useThemeColors', () => {
  it('returns the palette of the provided theme', async () => {
    const { result } = await renderHook(() => useThemeColors(), { wrapper: DarkContext });

    expect(result.current).toBe(palettes.dark);
  });

  it('throws outside ThemeProvider', async () => {
    await expect(renderHook(() => useThemeColors())).rejects.toThrow(
      MISSING_THEME_PROVIDER_MESSAGE,
    );
  });
});
