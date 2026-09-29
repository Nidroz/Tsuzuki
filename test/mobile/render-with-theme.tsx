import { render } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import { ThemeProvider } from '../../src/ui/theme/ThemeProvider';

interface WrapperProps {
  children: ReactNode;
}

// src/ui components that read a color value (useThemeColors) need the provider above them; the
// light palette makes color assertions predictable
function LightTheme({ children }: WrapperProps) {
  return <ThemeProvider preference="light">{children}</ThemeProvider>;
}

/** renders the element inside a light ThemeProvider */
export const renderWithTheme = (element: ReactElement) => render(element, { wrapper: LightTheme });
