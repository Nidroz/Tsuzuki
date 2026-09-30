import { I18nProvider, type Language, type MissingKeyHandler } from '@core/i18n/index';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '@ui/index';
import type { ComponentType, ReactElement, ReactNode } from 'react';

interface WrapperProps {
  readonly children: ReactNode;
}

interface AppProvidersProps extends WrapperProps {
  readonly language: Language;
}

export const missingKeyMessage = (language: string, key: string): string =>
  `missing translation key "${key}" (${language}): add it to en.json and fr.json`;

// a key missing from every catalog fails the test through fail-on-console (test/core), which
// points the failure at the t call. not a throw: an aborted render leaves listeners of the discarded
// tree (nativewind's color scheme) that log in the next test. module level: a new handler would
// give the provider a new i18next instance
const failOnMissingKey: MissingKeyHandler = (language, key) => {
  console.error(missingKeyMessage(language, key));
};

/**
 * the providers the composition root (app/_layout.tsx) gives every route and feature: the real
 * catalogs in `language`, a missing key failing the test, and the light palette for predictable
 * colors
 */
export function AppProviders({ language, children }: AppProvidersProps) {
  return (
    <I18nProvider language={language} onMissingKey={failOnMissingKey}>
      <ThemeProvider preference="light">{children}</ThemeProvider>
    </I18nProvider>
  );
}

function EnglishProviders({ children }: WrapperProps) {
  return <AppProviders language="en">{children}</AppProviders>;
}

function FrenchProviders({ children }: WrapperProps) {
  return <AppProviders language="fr">{children}</AppProviders>;
}

// one wrapper component per language: a rerender keeps the same providers
const PROVIDERS: Readonly<Record<Language, ComponentType<WrapperProps>>> = {
  en: EnglishProviders,
  fr: FrenchProviders,
};

/** the wrapper option of render and renderRouterAsync: AppProviders, english by default */
export const providersFor = (language: Language = 'en'): ComponentType<WrapperProps> =>
  PROVIDERS[language];

/** renders a route or feature component inside AppProviders, english by default */
export const renderWithProviders = (element: ReactElement, language: Language = 'en') =>
  render(element, { wrapper: providersFor(language) });
