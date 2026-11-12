import { describe, expect, it } from '@jest/globals';

import { createMemoryStorage } from './memory-storage';

describe('createMemoryStorage', () => {
  it('returns undefined for a key never written', () => {
    expect(createMemoryStorage().getString('memory-test.missing')).toBeUndefined();
  });

  it('round-trips and overwrites a string', () => {
    const storage = createMemoryStorage();
    storage.set('memory-test.theme', 'light');

    storage.set('memory-test.theme', 'dark');

    expect(storage.getString('memory-test.theme')).toBe('dark');
  });

  it('deletes a key', () => {
    const storage = createMemoryStorage();
    storage.set('memory-test.language', 'fr');

    storage.delete('memory-test.language');

    expect(storage.getString('memory-test.language')).toBeUndefined();
  });

  it('keeps each storage apart: nothing outlives its process', () => {
    createMemoryStorage().set('memory-test.kept', 'value');

    expect(createMemoryStorage().getString('memory-test.kept')).toBeUndefined();
  });
});
