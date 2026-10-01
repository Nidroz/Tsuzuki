import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import type { MissingKeyHandler } from './create-i18n';
import en from './en.json';
import fr from './fr.json';
import { MISSING_I18N_PROVIDER_MESSAGE, type Translation } from './i18n-context';
import { I18nProvider } from './I18nProvider';
import type { Language } from './languages';
import { useTranslation } from './use-translation';

const TITLE_TEST_ID = 'title';
const LANGUAGE_TEST_ID = 'language';
const NUMBER_TEST_ID = 'number';
const DATE_TEST_ID = 'date';
const MISSING_TEST_ID = 'missing';
const MISSING_KEY = 'missing.key';

const PI_DAY = new Date(Date.UTC(2026, 2, 14));
const LONG_DATE_IN_UTC: Intl.DateTimeFormatOptions = { dateStyle: 'long', timeZone: 'UTC' };

// shows what useTranslation gives a consumer
function TranslationProbe() {
  const { t, language, formatNumber, formatDate } = useTranslation();
  return (
    <>
      <h1 data-testid={TITLE_TEST_ID}>{t('tabs.discover')}</h1>
      <p data-testid={LANGUAGE_TEST_ID}>{language}</p>
      <p data-testid={NUMBER_TEST_ID}>{formatNumber(1234.5)}</p>
      <p data-testid={DATE_TEST_ID}>{formatDate(PI_DAY, LONG_DATE_IN_UTC)}</p>
    </>
  );
}

interface CaptureProps {
  readonly onRender: (translation: Translation) => void;
}

// hands the context value of each render to the test
function TranslationCapture({ onRender }: CaptureProps) {
  onRender(useTranslation());
  return null;
}

function MissingKeyProbe() {
  const { t } = useTranslation();
  // @ts-expect-error(type-test): the key is in no catalog, which typecheck rejects before run time
  return <p data-testid={MISSING_TEST_ID}>{t(MISSING_KEY)}</p>;
}

const textOf = (testId: string) => screen.getByTestId(testId).textContent;

const renderProbe = (language: Language) =>
  render(
    <I18nProvider language={language}>
      <TranslationProbe />
    </I18nProvider>,
  );

describe('I18nProvider', () => {
  it('shows its children in english', () => {
    renderProbe('en');

    expect(textOf(TITLE_TEST_ID)).toBe(en.tabs.discover);
    expect(textOf(LANGUAGE_TEST_ID)).toBe('en');
  });

  it('shows its children in french', () => {
    renderProbe('fr');

    expect(textOf(TITLE_TEST_ID)).toBe(fr.tabs.discover);
    expect(textOf(LANGUAGE_TEST_ID)).toBe('fr');
  });

  // the acceptance of F-06: switching the language updates the ui, in the render that receives it
  it('updates its children when the language changes', () => {
    const { rerender } = renderProbe('en');

    rerender(
      <I18nProvider language="fr">
        <TranslationProbe />
      </I18nProvider>,
    );

    expect(textOf(TITLE_TEST_ID)).toBe(fr.tabs.discover);
    expect(textOf(LANGUAGE_TEST_ID)).toBe('fr');

    rerender(
      <I18nProvider language="en">
        <TranslationProbe />
      </I18nProvider>,
    );

    expect(textOf(TITLE_TEST_ID)).toBe(en.tabs.discover);
    expect(textOf(LANGUAGE_TEST_ID)).toBe('en');
  });

  it('translates with the new language in the first render that receives it', () => {
    const titles: string[] = [];
    const onRender = ({ t }: Translation) => {
      titles.push(t('tabs.discover'));
    };
    const { rerender } = render(
      <I18nProvider language="en">
        <TranslationCapture onRender={onRender} />
      </I18nProvider>,
    );

    rerender(
      <I18nProvider language="fr">
        <TranslationCapture onRender={onRender} />
      </I18nProvider>,
    );

    // no render shows the new language with the old texts, or the reverse
    expect(titles).toStrictEqual([en.tabs.discover, fr.tabs.discover]);
  });

  it('formats numbers and dates in the active language', () => {
    const { rerender } = renderProbe('en');

    expect(textOf(NUMBER_TEST_ID)).toBe('1,234.5');
    expect(textOf(DATE_TEST_ID)).toBe('March 14, 2026');

    rerender(
      <I18nProvider language="fr">
        <TranslationProbe />
      </I18nProvider>,
    );

    // french groups digits with a narrow no-break space
    expect(textOf(NUMBER_TEST_ID)).toBe('1\u202F234,5');
    expect(textOf(DATE_TEST_ID)).toBe('14 mars 2026');
  });

  it('passes the format options through', () => {
    const values: string[] = [];
    render(
      <I18nProvider language="fr">
        <TranslationCapture
          onRender={({ formatNumber, formatDate }) => {
            values.push(formatNumber(0.25, { style: 'percent' }));
            values.push(formatDate(PI_DAY, { month: 'long', timeZone: 'UTC' }));
          }}
        />
      </I18nProvider>,
    );

    // french puts a no-break space before %
    expect(values).toStrictEqual(['25\u00A0%', 'mars']);
  });

  it('keeps the context value while the props stay the same, and replaces it on a new language', () => {
    const values: Translation[] = [];
    const onRender = (translation: Translation) => {
      values.push(translation);
    };
    const tree = (language: Language) => (
      <I18nProvider language={language}>
        <TranslationCapture onRender={onRender} />
      </I18nProvider>
    );
    const { rerender } = render(tree('en'));

    rerender(tree('en'));
    rerender(tree('fr'));
    rerender(tree('fr'));

    const [first, sameLanguage, french, sameFrench] = values;
    expect(values).toHaveLength(4);
    expect(sameLanguage).toBe(first);
    expect(french).not.toBe(first);
    expect(french?.t).not.toBe(first?.t);
    expect(sameFrench).toBe(french);
  });

  it('keeps the context value when the missing key handler stays the same', () => {
    const onMissingKey = jest.fn<MissingKeyHandler>();
    const values: Translation[] = [];
    const tree = (handler: MissingKeyHandler) => (
      <I18nProvider language="en" onMissingKey={handler}>
        <TranslationCapture onRender={(translation) => values.push(translation)} />
      </I18nProvider>
    );
    const { rerender } = render(tree(onMissingKey));

    rerender(tree(onMissingKey));
    rerender(tree(jest.fn<MissingKeyHandler>()));

    const [first, sameHandler, newHandler] = values;
    expect(sameHandler).toBe(first);
    expect(newHandler).not.toBe(first);
  });

  it.each<Language>(['en', 'fr'])('reports a missing key to onMissingKey in %s', (language) => {
    const onMissingKey = jest.fn<MissingKeyHandler>();

    render(
      <I18nProvider language={language} onMissingKey={onMissingKey}>
        <MissingKeyProbe />
      </I18nProvider>,
    );

    // i18next shows the key itself
    expect(textOf(MISSING_TEST_ID)).toBe(MISSING_KEY);
    expect(onMissingKey).toHaveBeenCalledWith(language, MISSING_KEY);
    expect(new Set(onMissingKey.mock.calls.map(([, key]) => key))).toStrictEqual(
      new Set([MISSING_KEY]),
    );
  });

  it('reports the missing key to the handler of the new language after a switch', () => {
    const onMissingKey = jest.fn<MissingKeyHandler>();
    const tree = (language: Language) => (
      <I18nProvider language={language} onMissingKey={onMissingKey}>
        <MissingKeyProbe />
      </I18nProvider>
    );
    const { rerender } = render(tree('en'));
    onMissingKey.mockClear();

    rerender(tree('fr'));

    expect(onMissingKey).toHaveBeenCalledWith('fr', MISSING_KEY);
    expect(onMissingKey).not.toHaveBeenCalledWith('en', MISSING_KEY);
  });

  it('shows a missing key without a handler, silently', () => {
    render(
      <I18nProvider language="fr">
        <MissingKeyProbe />
      </I18nProvider>,
    );

    expect(textOf(MISSING_TEST_ID)).toBe(MISSING_KEY);
  });
});

describe('useTranslation', () => {
  it('throws outside I18nProvider', () => {
    expect(() => render(<TranslationProbe />)).toThrow(MISSING_I18N_PROVIDER_MESSAGE);
  });
});
