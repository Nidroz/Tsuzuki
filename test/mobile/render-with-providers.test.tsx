import { type Language, useTranslation } from '@core/i18n/index';
import { describe, expect, it } from '@jest/globals';
import { screen } from '@testing-library/react-native';
import { Spinner, Text } from '@ui/index';

import en from '../../src/core/i18n/en.json';
import fr from '../../src/core/i18n/fr.json';
import { takeUnexpectedConsoleMessages } from '../core/fail-on-console';
import { missingKeyMessage, renderWithProviders } from './render-with-providers';

const MISSING_KEY = 'missing.key';
const SPINNER_LABEL = 'loading';

function Title() {
  const { t } = useTranslation();
  return <Text>{t('tabs.discover')}</Text>;
}

function MissingKeyTitle() {
  const { t } = useTranslation();
  // @ts-expect-error(type-test): the key is in no catalog, which typecheck rejects before run time
  return <Text>{t(MISSING_KEY)}</Text>;
}

describe('renderWithProviders', () => {
  it('translates with the real english catalog by default', async () => {
    await renderWithProviders(<Title />);

    expect(screen.getByText(en.tabs.discover)).toBeOnTheScreen();
  });

  it('translates with the catalog of the given language', async () => {
    await renderWithProviders(<Title />, 'fr');

    expect(screen.getByText(fr.tabs.discover)).toBeOnTheScreen();
  });

  it('gives the theme to components that read the palette', async () => {
    await renderWithProviders(<Spinner accessibilityLabel={SPINNER_LABEL} />);

    expect(screen.getByRole('progressbar', { name: SPINNER_LABEL })).toBeOnTheScreen();
  });

  it.each<Language>(['en', 'fr'])(
    'fails the test of a component asking for a missing key (%s)',
    async (language) => {
      await renderWithProviders(<MissingKeyTitle />, language);

      // what the check after each test throws on
      expect(takeUnexpectedConsoleMessages()).toStrictEqual([
        `unexpected console.error: ${missingKeyMessage(language, MISSING_KEY)}`,
      ]);
    },
  );
});
