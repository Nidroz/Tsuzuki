import { describe, expect, it, jest } from '@jest/globals';

import { RECENT_SEARCHES_MAX } from '../../domain/recent-searches';
import type { StorageAdapter } from '../storage-adapter';
import {
  RECENT_SEARCHES_STORAGE_KEY,
  createLocalRecentSearchesRepository,
} from './recent-searches-repository';

const MAX_QUERY_LENGTH = 10;
const LONE_HIGH = '\uD83D';
const PAIR = '\u{1F600}';

type MemoryStorage = StorageAdapter & { values: Map<string, string> };

const createMemoryStorage = (): MemoryStorage => {
  const values = new Map<string, string>();
  return {
    values,
    getString: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
    delete: (key) => {
      values.delete(key);
    },
  };
};

// a repository over a storage holding `stored` under the recent searches key, when given
const setup = (stored?: string) => {
  const storage = createMemoryStorage();
  if (stored !== undefined) {
    storage.values.set(RECENT_SEARCHES_STORAGE_KEY, stored);
  }
  const repository = createLocalRecentSearchesRepository(storage, {
    maxQueryLength: MAX_QUERY_LENGTH,
  });
  return { storage, repository };
};

describe('createLocalRecentSearchesRepository', () => {
  it('stores under the recent-searches key', () => {
    expect(RECENT_SEARCHES_STORAGE_KEY).toBe('recent-searches');
  });

  it('loads an empty list from an empty storage', () => {
    expect(setup().repository.load()).toStrictEqual([]);
  });

  it('saves the list as a json array of strings and loads it back', () => {
    const { storage, repository } = setup();
    repository.save(['frieren', 'naruto']);

    expect(storage.values.get(RECENT_SEARCHES_STORAGE_KEY)).toBe('["frieren","naruto"]');
    expect(repository.load()).toStrictEqual(['frieren', 'naruto']);
  });

  it('clears the stored list', () => {
    const { storage, repository } = setup('["frieren"]');
    repository.clear();

    expect(storage.values.has(RECENT_SEARCHES_STORAGE_KEY)).toBe(false);
    expect(repository.load()).toStrictEqual([]);
  });

  it.each<[string, string]>([
    ['invalid json', '["frieren"'],
    ['an object', '{"0":"frieren"}'],
    ['a string', '"frieren"'],
    ['null', 'null'],
    ['a number', '42'],
  ])('loads an empty list from %s', (_label, stored) => {
    expect(setup(stored).repository.load()).toStrictEqual([]);
  });

  it.each<[string, unknown]>([
    ['a number', 1],
    ['null', null],
    ['an array', ['nested']],
    ['a blank entry', '   '],
    ['the empty string', ''],
    ['an untrimmed entry', ' frieren'],
    ['an entry over the limit', 'a'.repeat(MAX_QUERY_LENGTH + 1)],
    ['a lone surrogate', `ab${LONE_HIGH}`],
  ])('drops %s and keeps the valid entries', (_label, entry) => {
    const { repository } = setup(JSON.stringify(['frieren', entry, 'naruto']));
    expect(repository.load()).toStrictEqual(['frieren', 'naruto']);
  });

  it('keeps entries at the limit, surrogate pairs included', () => {
    const atLimit = ['a'.repeat(MAX_QUERY_LENGTH), `${'b'.repeat(MAX_QUERY_LENGTH - 2)}${PAIR}`];
    expect(setup(JSON.stringify(atLimit)).repository.load()).toStrictEqual(atLimit);
  });

  it('applies the domain rules to the stored list', () => {
    const stored = ['Frieren', 'frieren', ...Array.from({ length: 12 }, (_, i) => `q${String(i)}`)];
    const loaded = setup(JSON.stringify(stored)).repository.load();

    expect(loaded).toHaveLength(RECENT_SEARCHES_MAX);
    expect(loaded[0]).toBe('Frieren');
    expect(loaded).not.toContain('frieren');
  });

  it.each<[string, number]>([
    ['zero', 0],
    ['a fraction', 2.5],
    ['NaN', Number.NaN],
  ])('throws a RangeError for %s as max query length', (_label, maxQueryLength) => {
    expect(() =>
      createLocalRecentSearchesRepository(createMemoryStorage(), { maxQueryLength }),
    ).toThrow(RangeError);
  });

  it('never writes to the console', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method),
    );
    const { repository } = setup('{not json');
    repository.load();
    repository.save(['secret search']);
    repository.load();
    repository.clear();

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
