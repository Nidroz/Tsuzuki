import type { MediaSummary } from '@core/catalog/catalog-provider';
import { useLibraryContext } from '@core/hooks/use-library-context';
import { useLibraryEntry } from '@core/hooks/use-library-entry';
import { useLibraryEntryActions } from '@core/hooks/use-library-entry-actions';
import type { LibraryRepository } from '@core/repositories/library-repository';
import type * as LocalLibrary from '@core/repositories/local/library-repository';
import { describe, expect, it, jest } from '@jest/globals';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act } from '@testing-library/react-native';
import { STORAGE_INSTANCE_ID } from '@platform/storage';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { createMMKV } from 'react-native-mmkv';

import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { appRoutesWithDiscover } from './app-routes';

// the library wiring (L-03): the composition root (app/_layout.tsx) creates the guest library repository over the app
// storage, once, when the layout module loads, and gives it to the library hooks. the factory
// keeps its real behaviour and records its calls

jest.mock('@core/repositories/local/library-repository', () => {
  const actual = jest.requireActual<typeof LocalLibrary>(
    '@core/repositories/local/library-repository',
  );
  return { ...actual, createLocalLibraryRepository: jest.fn(actual.createLocalLibraryRepository) };
});

// no http: the stub route below replaces Discover, and nothing else reads the catalog
jest.mock('@core/catalog/jikan/jikan-catalog-provider', () =>
  jest.requireActual<typeof FakeJikanModule>('../mobile/fake-jikan-module').fakeJikanModule(),
);

jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => [{ languageTag: 'en-US' }],
}));

// the layout opens its storage when it is imported: the shared instance lets the test read it
jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof SharedMmkv>('../mobile/shared-mmkv').sharedMmkvModule(),
);

// read from the mock registry: a static import would load the module before @jest/globals,
// which the hoisted factory above needs
const localLibrary = jest.requireMock<typeof LocalLibrary>(
  '@core/repositories/local/library-repository',
);
const createLocalLibrary = jest.mocked(localLibrary.createLocalLibraryRepository);

const appStorage = createMMKV({ id: STORAGE_INSTANCE_ID });

const MEDIA: MediaSummary = {
  key: { namespace: 'mal', kind: 'anime', externalId: 52991 },
  title: 'Sousou no Frieren',
  titleEnglish: null,
  imageUrl: null,
  format: 'tv',
  status: 'finished',
  totalUnits: 28,
  score: null,
  year: null,
  genres: [],
  isAdult: false,
};
const LOADED_TEXT = 'library entry loaded';

// what the stub Discover route received from the library context and hooks
const seen: { repository: LibraryRepository | null; add: (() => void) | null } = {
  repository: null,
  add: null,
};

function LibraryProbe() {
  const { repository } = useLibraryContext();
  const entry = useLibraryEntry(MEDIA.key, { media: MEDIA });
  const { add } = useLibraryEntryActions(MEDIA.key, { media: MEDIA });
  useEffect(() => {
    seen.repository = repository;
    seen.add = add;
  }, [repository, add]);
  return entry.isSuccess ? <Text>{LOADED_TEXT}</Text> : null;
}

describe('root layout library wiring (L-03)', () => {
  it('creates one guest library repository over the app storage, with the reporter', () => {
    expect(createLocalLibrary).toHaveBeenCalledTimes(1);
    expect(createLocalLibrary).toHaveBeenCalledWith(expect.any(Object), {
      reporter: expect.any(Object),
    });
  });

  it('gives the library hooks that repository, so an add lands in the app storage', async () => {
    appStorage.clearAll();
    await renderRouterAsync(appRoutesWithDiscover(LibraryProbe));
    expect(await screen.findByText(LOADED_TEXT)).toBeOnTheScreen();

    expect(seen.repository).toBe(createLocalLibrary.mock.results[0]?.value);

    await act(async () => {
      seen.add?.();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(appStorage.getString(localLibrary.GUEST_LIBRARY_STORAGE_KEY)).toContain(MEDIA.title);
    await expect(seen.repository?.get(MEDIA.key)).resolves.toMatchObject({
      key: MEDIA.key,
      status: 'planned',
    });
  });
});
