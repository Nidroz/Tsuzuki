// a pure checker of a translation catalog against the reference catalog (en.json): the parity test
// (src/core/i18n/catalogs.test.ts) runs it on the real catalogs, so a missing, extra or broken
// translation fails a test. catalogs are nested objects of strings, keys joined with "." as
// i18next reads them, plural forms written with i18next suffixes:
// - cardinal forms `items_<category>`, one per category of Intl.PluralRules(language). i18next
//   also looks up `items_zero` for a count of 0 in every language: that form is optional, allowed
//   next to any cardinal plural key, and required only where the language has a zero category
// - ordinal forms `place_ordinal_<category>`, one per category of
//   Intl.PluralRules(language, { type: 'ordinal' }); i18next has no optional zero ordinal form
// limits:
// - the suffix alone makes a key plural: a text key named `step_one` or `intro_other` is read as
//   a plural form and fails with its other forms missing. name such keys without a trailing
//   `_<category>` (firstStep)
// - the checker follows i18next's default separators ("." for nesting, "_" for plural forms)
//   and knows nothing of contexts: a context key (`friend_male`) is compared as an ordinary key

const KEY_SEPARATOR = '.';
const PLURAL_SEPARATOR = '_';
const ORDINAL_MARKER = 'ordinal';
const ZERO_CATEGORY = 'zero';
// every cldr plural category, the suffixes i18next looks up with Intl.PluralRules
const CATEGORY = '(?:zero|one|two|few|many|other)';
const ORDINAL_SUFFIX = new RegExp(
  `${PLURAL_SEPARATOR}${ORDINAL_MARKER}${PLURAL_SEPARATOR}${CATEGORY}$`,
);
const CARDINAL_SUFFIX = new RegExp(`${PLURAL_SEPARATOR}${CATEGORY}$`);
// {{name}}, {{ name }} and {{name, format}}: the name only
const PLACEHOLDER = /\{\{\s*([^\s,}]+)[^}]*\}\}/g;

type Leaves = ReadonlyMap<string, unknown>;
type PluralType = 'cardinal' | 'ordinal';
type PluralForm = { readonly base: string; readonly type: PluralType };

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

// the key a plural form belongs to and its plural type (items, cardinal for items_one; place,
// ordinal for place_ordinal_one), or undefined for a key that is not a plural form
const pluralFormOf = (key: string): PluralForm | undefined => {
  for (const [type, suffix] of [
    ['ordinal', ORDINAL_SUFFIX],
    ['cardinal', CARDINAL_SUFFIX],
  ] as const) {
    const match = suffix.exec(key);
    if (match !== null) {
      return { base: key.slice(0, match.index), type };
    }
  }
  return undefined;
};

const baseKey = (key: string): string => pluralFormOf(key)?.base ?? key;

const formKey = ({ base, type }: PluralForm, category: string): string =>
  type === 'ordinal'
    ? `${base}${PLURAL_SEPARATOR}${ORDINAL_MARKER}${PLURAL_SEPARATOR}${category}`
    : `${base}${PLURAL_SEPARATOR}${category}`;

const placeholdersOf = (value: unknown): ReadonlySet<string> =>
  new Set(
    typeof value === 'string'
      ? [...value.matchAll(PLACEHOLDER)].flatMap(([, name]) => name ?? [])
      : [],
  );

// the placeholders of every form of each key: a plural form may leave out {{count}} ("one item")
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

/**
 * the plural categories Intl.PluralRules selects for the language, e.g. one, many, other for
 * cardinal numbers in fr, or one, two, few, other for ordinal numbers in en
 */
export const pluralCategoriesOf = (
  language: string,
  type: PluralType = 'cardinal',
): readonly string[] => new Intl.PluralRules(language, { type }).resolvedOptions().pluralCategories;

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
  const referenceForms = [...referenceLeaves.keys()].map((key) => ({
    key,
    form: pluralFormOf(key),
  }));

  // a plural key of the reference needs one form per plural category of the language
  const expectedKeys = new Set(
    referenceForms.flatMap(({ key, form }) =>
      form === undefined
        ? [key]
        : pluralCategoriesOf(language, form.type).map((category) => formKey(form, category)),
    ),
  );
  // the zero form of a cardinal plural key may be present or not
  const optionalKeys = new Set(
    referenceForms.flatMap(({ form }) =>
      form?.type === 'cardinal' ? [formKey(form, ZERO_CATEGORY)] : [],
    ),
  );

  const problems: string[] = [];
  for (const key of expectedKeys) {
    if (!candidateLeaves.has(key)) {
      problems.push(`${language}: missing key "${key}"`);
    }
  }
  for (const [key, value] of candidateLeaves) {
    if (!expectedKeys.has(key) && !optionalKeys.has(key)) {
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
