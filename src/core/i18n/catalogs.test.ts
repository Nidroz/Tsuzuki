import { describe, expect, it } from '@jest/globals';

import { compareCatalogs } from '../../../test/core/i18n-catalog-parity';
import en from './en.json';
import fr from './fr.json';
import { FALLBACK_LANGUAGE, SUPPORTED_LANGUAGES } from './languages';
import { type Catalog, resources } from './resources';

// the keys of every text of a catalog, nested keys joined with "."
const keysOf = (catalog: Catalog, prefix = ''): string[] =>
  Object.entries(catalog).flatMap(([name, value]) => {
    const key = prefix === '' ? name : `${prefix}.${name}`;
    return typeof value === 'string' ? [key] : keysOf(value, key);
  });

// a copy of the catalog without the text at key
const withoutKey = (catalog: Catalog, key: string): Catalog => {
  const [head = '', ...rest] = key.split('.');
  return Object.fromEntries(
    Object.entries(catalog).flatMap(([name, value]): [string, string | Catalog][] => {
      if (name !== head) {
        return [[name, value]];
      }
      return typeof value === 'string' || rest.length === 0
        ? []
        : [[name, withoutKey(value, rest.join('.'))]];
    }),
  );
};

// en.json is the reference: it types the keys (i18next.d.ts) and is the fallback catalog
describe('translation catalogs', () => {
  it('are bundled for every supported language, english being the fallback', () => {
    expect(Object.keys(resources).sort()).toStrictEqual([...SUPPORTED_LANGUAGES].sort());
    expect(resources[FALLBACK_LANGUAGE].translation).toBe(en);
    expect(resources.fr.translation).toBe(fr);
  });

  it('has an english catalog with non-empty texts and every english plural form', () => {
    expect(compareCatalogs(en, en, 'en')).toStrictEqual([]);
  });

  it('has a french catalog with exactly the english keys, placeholders and french plural forms', () => {
    expect(compareCatalogs(en, fr, 'fr')).toStrictEqual([]);
  });

  it('holds at least one text, so the checks above compare something', () => {
    expect(keysOf(en).length).toBeGreaterThan(0);
  });

  // the acceptance of F-06: a key missing from the french catalog fails the parity test above.
  // every french key, french-only plural forms (items_many) included
  it.each(keysOf(fr))('fails when the french catalog lacks "%s"', (key) => {
    expect(compareCatalogs(en, withoutKey(fr, key), 'fr')).toStrictEqual([
      `fr: missing key "${key}"`,
    ]);
  });

  // a text removed from en.json is an extra french key; a plural form removed from en.json is a
  // missing english form, since the french forms follow the french plural categories
  it.each(keysOf(en))('fails when the english catalog lacks "%s"', (key) => {
    const english = withoutKey(en, key);

    const problems = [
      ...compareCatalogs(english, english, 'en'),
      ...compareCatalogs(english, fr, 'fr'),
    ];

    expect(problems).toContainEqual(expect.stringContaining(`key "${key}"`));
  });
});
