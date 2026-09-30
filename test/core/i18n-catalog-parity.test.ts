import { describe, expect, it } from '@jest/globals';

import { compareCatalogs, pluralCategoriesOf } from './i18n-catalog-parity';

// the checker compares keys, placeholders and plural categories, never wording: the texts are
// neutral markers of the language and form they stand for
const REFERENCE = {
  home: { title: 'Home', greeting: 'Hello {{name}}' },
  library: { items_one: '{{count}} item', items_other: '{{count}} items' },
};

const COMPLETE_FRENCH = {
  home: { title: 'fr title', greeting: 'fr greeting {{name}}' },
  library: {
    items_one: '{{count}} fr-one',
    items_many: '{{count}} fr-many',
    items_other: '{{count}} fr-other',
  },
};

describe('pluralCategoriesOf', () => {
  it('gives the cardinal categories Intl.PluralRules selects for each language', () => {
    expect([...pluralCategoriesOf('en')].sort()).toStrictEqual(['one', 'other']);
    expect([...pluralCategoriesOf('fr')].sort()).toStrictEqual(['many', 'one', 'other']);
    expect([...pluralCategoriesOf('fr', 'cardinal')].sort()).toStrictEqual([
      'many',
      'one',
      'other',
    ]);
  });

  it('gives the ordinal categories Intl.PluralRules selects for each language', () => {
    expect([...pluralCategoriesOf('en', 'ordinal')].sort()).toStrictEqual([
      'few',
      'one',
      'other',
      'two',
    ]);
    expect([...pluralCategoriesOf('fr', 'ordinal')].sort()).toStrictEqual(['one', 'other']);
  });
});

describe('compareCatalogs', () => {
  it('finds no problem in a complete translation', () => {
    expect(compareCatalogs(REFERENCE, COMPLETE_FRENCH, 'fr')).toStrictEqual([]);
  });

  it('finds no problem in a complete catalog compared with itself', () => {
    expect(compareCatalogs(REFERENCE, REFERENCE, 'en')).toStrictEqual([]);
    expect(compareCatalogs(COMPLETE_FRENCH, COMPLETE_FRENCH, 'fr')).toStrictEqual([]);
  });

  it('reports a missing key with its full nested path', () => {
    const candidate = { ...COMPLETE_FRENCH, home: { greeting: 'fr greeting {{name}}' } };

    expect(compareCatalogs(REFERENCE, candidate, 'fr')).toStrictEqual([
      'fr: missing key "home.title"',
    ]);
  });

  it('reports a missing object as each of its keys', () => {
    const { library } = COMPLETE_FRENCH;

    expect(compareCatalogs(REFERENCE, { library }, 'fr')).toStrictEqual([
      'fr: missing key "home.title"',
      'fr: missing key "home.greeting"',
    ]);
  });

  it('reports an extra key', () => {
    const candidate = {
      ...COMPLETE_FRENCH,
      home: { ...COMPLETE_FRENCH.home, subtitle: 'fr subtitle' },
      stale: 'fr stale',
    };

    expect(compareCatalogs(REFERENCE, candidate, 'fr')).toStrictEqual([
      'fr: extra key "home.subtitle"',
      'fr: extra key "stale"',
    ]);
  });

  it('reports a key moved to another object as missing and extra', () => {
    const candidate = {
      ...COMPLETE_FRENCH,
      home: { greeting: 'fr greeting {{name}}' },
      library: { ...COMPLETE_FRENCH.library, title: 'fr title' },
    };

    expect(compareCatalogs(REFERENCE, candidate, 'fr')).toStrictEqual([
      'fr: missing key "home.title"',
      'fr: extra key "library.title"',
    ]);
  });

  it.each(['', '   ', '\n'])('reports an empty or blank value (%j)', (value) => {
    const candidate = { ...COMPLETE_FRENCH, home: { ...COMPLETE_FRENCH.home, title: value } };

    expect(compareCatalogs(REFERENCE, candidate, 'fr')).toStrictEqual([
      'fr: "home.title" is empty',
    ]);
  });

  it.each<[string, unknown]>([
    ['a number', 42],
    ['a boolean', true],
    ['null', null],
    ['an array', ['fr title']],
  ])('reports a value that is not a string: %s', (_label, value) => {
    const candidate = { ...COMPLETE_FRENCH, home: { ...COMPLETE_FRENCH.home, title: value } };

    expect(compareCatalogs(REFERENCE, candidate, 'fr')).toStrictEqual([
      'fr: "home.title" is not a string',
    ]);
  });

  it('reports a text replaced by an object as missing, with the keys of the object as extra', () => {
    const candidate = {
      ...COMPLETE_FRENCH,
      home: { ...COMPLETE_FRENCH.home, title: { short: 'fr title' } },
    };

    expect(compareCatalogs(REFERENCE, candidate, 'fr')).toStrictEqual([
      'fr: missing key "home.title"',
      'fr: extra key "home.title.short"',
    ]);
  });

  it('reports a renamed placeholder', () => {
    const candidate = {
      ...COMPLETE_FRENCH,
      library: {
        items_one: '{{n}} fr-one',
        items_many: '{{n}} fr-many',
        items_other: '{{n}} fr-other',
      },
    };

    expect(compareCatalogs(REFERENCE, candidate, 'fr')).toStrictEqual([
      'fr: "library.items" has placeholders {{n}}, expected {{count}}',
    ]);
  });

  it('reports a missing and an added placeholder', () => {
    const candidate = {
      ...COMPLETE_FRENCH,
      home: { title: 'fr title {{name}}', greeting: 'fr greeting' },
    };

    expect(compareCatalogs(REFERENCE, candidate, 'fr')).toStrictEqual([
      'fr: "home.title" has placeholders {{name}}, expected none',
      'fr: "home.greeting" has placeholders none, expected {{name}}',
    ]);
  });

  it('reads placeholders with spaces or a format as their name', () => {
    const candidate = {
      ...COMPLETE_FRENCH,
      home: { ...COMPLETE_FRENCH.home, greeting: 'fr greeting {{ name }}' },
      library: {
        items_one: '{{count, number}} fr-one',
        items_many: '{{count, number}} fr-many',
        items_other: '{{count, number}} fr-other',
      },
    };

    expect(compareCatalogs(REFERENCE, candidate, 'fr')).toStrictEqual([]);
  });

  it('accepts a plural form without the count when another form of the key has it', () => {
    const candidate = {
      ...COMPLETE_FRENCH,
      library: { ...COMPLETE_FRENCH.library, items_one: 'fr-one without count' },
    };

    expect(compareCatalogs(REFERENCE, candidate, 'fr')).toStrictEqual([]);
  });

  it('reports a plural category of the language that the catalog lacks', () => {
    // english has no many form: a french catalog copied from it misses one
    const candidate = {
      ...COMPLETE_FRENCH,
      library: { items_one: '{{count}} fr-one', items_other: '{{count}} fr-other' },
    };

    expect(compareCatalogs(REFERENCE, candidate, 'fr')).toStrictEqual([
      'fr: missing key "library.items_many"',
    ]);
  });

  it('reports a plural category missing from the reference itself', () => {
    const english = { ...REFERENCE, library: { items_other: '{{count}} items' } };

    expect(compareCatalogs(english, english, 'en')).toStrictEqual([
      'en: missing key "library.items_one"',
    ]);
  });

  it('reports a plural form of a category the language does not have', () => {
    const candidate = { ...REFERENCE, library: { ...REFERENCE.library, items_many: 'many' } };

    expect(compareCatalogs(REFERENCE, candidate, 'en')).toStrictEqual([
      'en: extra key "library.items_many"',
    ]);
  });

  it('reports a plural key translated as a single text', () => {
    const candidate = { ...COMPLETE_FRENCH, library: { items: '{{count}} fr-other' } };

    // the forms follow the order Intl.PluralRules lists the categories in
    expect(compareCatalogs(REFERENCE, candidate, 'fr').sort()).toStrictEqual([
      'fr: extra key "library.items"',
      'fr: missing key "library.items_many"',
      'fr: missing key "library.items_one"',
      'fr: missing key "library.items_other"',
    ]);
  });

  // a known limit: the suffix alone makes a key plural, so a text key named like a plural form
  // fails loudly with its other forms missing instead of passing unchecked
  it('reads a text key ending in a plural category as a plural form', () => {
    const reference = { onboarding: { step_one: 'First step' } };

    expect(compareCatalogs(reference, reference, 'en')).toStrictEqual([
      'en: missing key "onboarding.step_other"',
    ]);
  });

  it('checks keys nested at any depth', () => {
    const reference = { a: { b: { c: { d: 'Deep {{value}}' } } } };

    expect(
      compareCatalogs(reference, { a: { b: { c: { d: 'fr deep {{value}}' } } } }, 'fr'),
    ).toStrictEqual([]);
    expect(compareCatalogs(reference, { a: { b: { c: {} } } }, 'fr')).toStrictEqual([
      'fr: missing key "a.b.c.d"',
    ]);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'catalog'],
    ['an array', [REFERENCE]],
  ])('reports a catalog that is not an object: %s', (_label, candidate) => {
    expect(compareCatalogs(REFERENCE, candidate, 'fr')).toStrictEqual([
      'fr: the catalog is not an object',
    ]);
  });
});
