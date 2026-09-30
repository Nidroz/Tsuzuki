import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// the intl members hermes lacks: the polyfill must work without both
const MISSING_ON_HERMES = ['PluralRules', 'Locale'] as const;

const NativePluralRules = Intl.PluralRules;

const nativeDescriptors = MISSING_ON_HERMES.map(
  (name) => [name, Object.getOwnPropertyDescriptor(Intl, name)] as const,
);

const restoreNativeIntl = () => {
  for (const [name, descriptor] of nativeDescriptors) {
    if (descriptor) {
      Object.defineProperty(Intl, name, descriptor);
    }
  }
};

// a fresh module registry each time: the polyfill runs its detection when first loaded
const loadPolyfills = () => {
  jest.isolateModules(() => {
    jest.requireActual('./intl-polyfills');
  });
};

afterEach(restoreNativeIntl);

describe('intl polyfills on an engine without Intl.PluralRules', () => {
  beforeEach(() => {
    for (const name of MISSING_ON_HERMES) {
      Reflect.deleteProperty(Intl, name);
    }
    loadPolyfills();
  });

  it('installs Intl.PluralRules', () => {
    expect(typeof Intl.PluralRules).toBe('function');
    expect(Intl.PluralRules).not.toBe(NativePluralRules);
  });

  it('gives french its one, many and other cardinal forms', () => {
    const rules = new Intl.PluralRules('fr');

    expect([0, 1, 1.5, 2, 1_000_000].map((count) => rules.select(count))).toStrictEqual([
      'one',
      'one',
      'one',
      'other',
      'many',
    ]);
  });

  it('gives english its one and other cardinal forms', () => {
    const rules = new Intl.PluralRules('en');

    expect([0, 1, 2].map((count) => rules.select(count))).toStrictEqual(['other', 'one', 'other']);
  });

  it('gives the ordinal forms of both languages', () => {
    const english = new Intl.PluralRules('en', { type: 'ordinal' });
    const french = new Intl.PluralRules('fr', { type: 'ordinal' });

    expect([1, 2, 3, 4].map((rank) => english.select(rank))).toStrictEqual([
      'one',
      'two',
      'few',
      'other',
    ]);
    expect([1, 2].map((rank) => french.select(rank))).toStrictEqual(['one', 'other']);
  });
});

describe('intl polyfills on an engine with Intl.PluralRules', () => {
  it('leaves the native Intl.PluralRules untouched', () => {
    loadPolyfills();

    expect(Intl.PluralRules).toBe(NativePluralRules);
  });
});
