import { describe, expect, it } from '@jest/globals';

import { compareCatalogs } from './i18n-catalog-parity';

// the optional zero form and the ordinal forms of i18next plurals. the texts are neutral markers
// of the language and form they stand for: the checker never reads wording
const REFERENCE = {
  home: { title: 'Home' },
  library: { items_one: '{{count}} item', items_other: '{{count}} items' },
};

const COMPLETE_FRENCH = {
  home: { title: 'fr title' },
  library: {
    items_one: '{{count}} fr-one',
    items_many: '{{count}} fr-many',
    items_other: '{{count}} fr-other',
  },
};

describe('compareCatalogs with plural forms', () => {
  describe('the optional zero form', () => {
    const REFERENCE_WITH_ZERO = {
      ...REFERENCE,
      library: { ...REFERENCE.library, items_zero: 'No items' },
    };

    it('accepts a zero form, without the count, in the reference and in a translation', () => {
      const candidate = {
        ...COMPLETE_FRENCH,
        library: { ...COMPLETE_FRENCH.library, items_zero: 'fr-zero' },
      };

      expect(compareCatalogs(REFERENCE_WITH_ZERO, REFERENCE_WITH_ZERO, 'en')).toStrictEqual([]);
      expect(compareCatalogs(REFERENCE_WITH_ZERO, candidate, 'fr')).toStrictEqual([]);
    });

    it('accepts a translation without the zero form of the reference, or with one of its own', () => {
      const candidate = {
        ...COMPLETE_FRENCH,
        library: { ...COMPLETE_FRENCH.library, items_zero: 'fr-zero' },
      };

      expect(compareCatalogs(REFERENCE_WITH_ZERO, COMPLETE_FRENCH, 'fr')).toStrictEqual([]);
      expect(compareCatalogs(REFERENCE, candidate, 'fr')).toStrictEqual([]);
    });

    it('checks the value of a zero form like any other text', () => {
      const candidate = {
        ...COMPLETE_FRENCH,
        library: { ...COMPLETE_FRENCH.library, items_zero: ' ' },
      };

      expect(compareCatalogs(REFERENCE, candidate, 'fr')).toStrictEqual([
        'fr: "library.items_zero" is empty',
      ]);
    });

    it('checks the placeholders of a zero form with the other forms of its key', () => {
      const candidate = {
        ...COMPLETE_FRENCH,
        library: { ...COMPLETE_FRENCH.library, items_zero: '{{total}} fr-zero' },
      };

      expect(compareCatalogs(REFERENCE, candidate, 'fr')).toStrictEqual([
        'fr: "library.items" has placeholders {{count}} {{total}}, expected {{count}}',
      ]);
    });

    it('reports a zero form of a key that is not plural in the reference', () => {
      const candidate = {
        ...COMPLETE_FRENCH,
        home: { ...COMPLETE_FRENCH.home, title_zero: 'fr-zero' },
      };

      expect(compareCatalogs(REFERENCE, candidate, 'fr')).toStrictEqual([
        'fr: extra key "home.title_zero"',
      ]);
    });

    it('requires the zero form in a language that has a zero category', () => {
      // latvian selects zero for 0, 10 to 20, 30 and so on
      expect(compareCatalogs(REFERENCE, REFERENCE, 'lv')).toStrictEqual([
        'lv: missing key "library.items_zero"',
      ]);
    });
  });

  describe('ordinal forms', () => {
    const REFERENCE_WITH_ORDINAL = {
      ranking: {
        place_ordinal_one: '{{count}}st',
        place_ordinal_two: '{{count}}nd',
        place_ordinal_few: '{{count}}rd',
        place_ordinal_other: '{{count}}th',
      },
    };
    const FRENCH_ORDINAL = {
      ranking: { place_ordinal_one: '{{count}} fr-one', place_ordinal_other: '{{count}} fr-other' },
    };

    it('expects one form per ordinal category of the language', () => {
      expect(compareCatalogs(REFERENCE_WITH_ORDINAL, REFERENCE_WITH_ORDINAL, 'en')).toStrictEqual(
        [],
      );
      expect(compareCatalogs(REFERENCE_WITH_ORDINAL, FRENCH_ORDINAL, 'fr')).toStrictEqual([]);
    });

    it('reports a missing ordinal category', () => {
      const incomplete = Object.fromEntries(
        Object.entries(REFERENCE_WITH_ORDINAL.ranking).filter(
          ([key]) => key !== 'place_ordinal_two',
        ),
      );

      expect(compareCatalogs(REFERENCE_WITH_ORDINAL, { ranking: incomplete }, 'en')).toStrictEqual([
        'en: missing key "ranking.place_ordinal_two"',
      ]);
    });

    it('reports an ordinal category the language does not have', () => {
      // english ordinal forms copied into french: french ordinals only have one and other
      expect(compareCatalogs(REFERENCE_WITH_ORDINAL, REFERENCE_WITH_ORDINAL, 'fr')).toStrictEqual([
        'fr: extra key "ranking.place_ordinal_two"',
        'fr: extra key "ranking.place_ordinal_few"',
      ]);
    });

    it('has no optional zero ordinal form', () => {
      const candidate = {
        ranking: { ...FRENCH_ORDINAL.ranking, place_ordinal_zero: 'fr-zero' },
      };

      expect(compareCatalogs(REFERENCE_WITH_ORDINAL, candidate, 'fr')).toStrictEqual([
        'fr: extra key "ranking.place_ordinal_zero"',
      ]);
    });

    it('does not take ordinal forms for cardinal ones, nor the reverse', () => {
      // french cardinal forms where ordinal forms are expected
      const candidate = {
        ranking: { place_one: '{{count}} fr-one', place_other: '{{count}} fr-other' },
      };

      expect(compareCatalogs(REFERENCE_WITH_ORDINAL, candidate, 'fr')).toStrictEqual([
        'fr: missing key "ranking.place_ordinal_one"',
        'fr: missing key "ranking.place_ordinal_other"',
        'fr: extra key "ranking.place_one"',
        'fr: extra key "ranking.place_other"',
      ]);
    });

    it('checks cardinal and ordinal forms of the same key side by side', () => {
      const reference = {
        ranking: { ...REFERENCE_WITH_ORDINAL.ranking, place_one: 'place', place_other: 'places' },
      };
      const candidate = {
        ranking: {
          ...FRENCH_ORDINAL.ranking,
          place_one: 'fr-one',
          place_many: 'fr-many',
          place_other: 'fr-other',
        },
      };

      expect(compareCatalogs(reference, candidate, 'fr')).toStrictEqual([]);
    });
  });
});
