import { describe, expect, it } from '@jest/globals';

import { createI18n } from './create-i18n';
import en from './en.json';
import { DEFAULT_NAMESPACE } from './resources';
import type { TranslationKey } from './use-translation';

// typecheck runs over this file: each @ts-expect-error(type-test) line must stay a type error, or
// typecheck fails on the unused directive. jest runs the same lines, so the runtime side of each
// case is asserted too
describe('typed translation keys', () => {
  const t = createI18n({ language: 'en' }).getFixedT('en', DEFAULT_NAMESPACE);

  it('accepts a key of en.json', () => {
    const key: TranslationKey = 'home.title';

    expect(t('home.title')).toBe(en.home.title);
    expect(t(key)).toBe(en.home.title);
  });

  it('rejects a key that is not in en.json', () => {
    // @ts-expect-error(type-test): an unknown key is a type error
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  it('rejects an unknown key even with a default value', () => {
    // @ts-expect-error(type-test): a default value does not make an unknown key acceptable
    expect(t('does.not.exist', 'Default')).toBe('Default');
  });

  it('rejects a prefix of a key, which names a catalog object and not a text', () => {
    // @ts-expect-error(type-test): home is an object of the catalog, not a text
    const prefix: TranslationKey = 'home';

    expect(prefix).toBe('home');
  });

  it('rejects an unknown key where a key is expected', () => {
    // @ts-expect-error(type-test): a TranslationKey holds only keys of en.json
    const unknown: TranslationKey = 'home.subtitle';

    expect(t(unknown)).toBe('home.subtitle');
  });
});
