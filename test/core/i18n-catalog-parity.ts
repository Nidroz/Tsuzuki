// a pure checker of a translation catalog against the reference catalog (en.json): the parity test
// (src/core/i18n/catalogs.test.ts) runs it on the real catalogs, so a missing, extra or broken
// translation fails a test. catalogs are nested objects of strings, keys joined with "." as
// i18next reads them, plural forms written with i18next suffixes (items_one, items_other)

const KEY_SEPARATOR = '.';
const PLURAL_SEPARATOR = '_';
// every cldr plural category, the suffixes i18next looks up with Intl.PluralRules
const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/;
// {{name}}, {{ name }} and {{name, format}}: the name only
const PLACEHOLDER = /\{\{\s*([^\s,}]+)[^}]*\}\}/g;

type Leaves = ReadonlyMap<string, unknown>;

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// every leaf (a value that is not a plain object) under its full key
const flatten = (catalog: unknown, prefix = ''): Leaves => {
  if (!isPlainObject(catalog)) {
    return new Map([[prefix, catalog]]);
  }
  return new Map(
    Object.entries(catalog).flatMap(([name, value]) => [
      ...flatten(value, prefix === '' ? name : `${prefix}${KEY_SEPARATOR}${name}`),
    ]),
  );
};

// the key a plural form belongs to (items for items_one), or the key itself
const baseKey = (key: string): string => key.replace(PLURAL_SUFFIX, '');

const placeholdersOf = (value: unknown): ReadonlySet<string> =>
  new Set(
    typeof value === 'string'
      ? [...value.matchAll(PLACEHOLDER)].flatMap(([, name]) => name ?? [])
      : [],
  );

// the placeholders of every form of each key: a plural form may leave out {{count}} ("un élément")
// as long as another form of the key uses it
const placeholdersByBaseKey = (leaves: Leaves): ReadonlyMap<string, ReadonlySet<string>> => {
  const byBase = new Map<string, Set<string>>();
  for (const [key, value] of leaves) {
    const placeholders = byBase.get(baseKey(key)) ?? new Set<string>();
    for (const name of placeholdersOf(value)) {
      placeholders.add(name);
    }
    byBase.set(baseKey(key), placeholders);
  }
  return byBase;
};

const describeSet = (names: ReadonlySet<string>): string =>
  names.size === 0
    ? 'none'
    : [...names]
        .sort()
        .map((name) => `{{${name}}}`)
        .join(' ');

const sameSet = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  left.size === right.size && [...left].every((name) => right.has(name));

/** the plural categories Intl.PluralRules selects for the language, e.g. one, many, other for fr */
export const pluralCategoriesOf = (language: string): readonly string[] =>
  new Intl.PluralRules(language).resolvedOptions().pluralCategories;

/**
 * the problems of `candidate`, the catalog of `language`, against `reference`: a missing key, an
 * extra key, a value that is not a string or is blank, placeholders that differ from the
 * reference's, and a plural key without a form for every plural category of the language.
 * compare a catalog with itself to check its own plural forms and values. no problem: []
 */
export const compareCatalogs = (
  reference: unknown,
  candidate: unknown,
  language: string,
): string[] => {
  if (!isPlainObject(candidate)) {
    return [`${language}: the catalog is not an object`];
  }
  const referenceLeaves = flatten(reference);
  const candidateLeaves = flatten(candidate);
  const categories = pluralCategoriesOf(language);

  // a plural key of the reference needs one form per plural category of the language
  const expectedKeys = new Set(
    [...referenceLeaves.keys()].flatMap((key) =>
      PLURAL_SUFFIX.test(key)
        ? categories.map((category) => `${baseKey(key)}${PLURAL_SEPARATOR}${category}`)
        : [key],
    ),
  );

  const problems: string[] = [];
  for (const key of expectedKeys) {
    if (!candidateLeaves.has(key)) {
      problems.push(`${language}: missing key "${key}"`);
    }
  }
  for (const [key, value] of candidateLeaves) {
    if (!expectedKeys.has(key)) {
      problems.push(`${language}: extra key "${key}"`);
    } else if (typeof value !== 'string') {
      problems.push(`${language}: "${key}" is not a string`);
    } else if (value.trim() === '') {
      problems.push(`${language}: "${key}" is empty`);
    }
  }

  const referencePlaceholders = placeholdersByBaseKey(referenceLeaves);
  const candidatePlaceholders = placeholdersByBaseKey(candidateLeaves);
  for (const [key, expected] of referencePlaceholders) {
    const actual = candidatePlaceholders.get(key);
    if (actual !== undefined && !sameSet(expected, actual)) {
      problems.push(
        `${language}: "${key}" has placeholders ${describeSet(actual)}, expected ${describeSet(expected)}`,
      );
    }
  }
  return problems;
};
