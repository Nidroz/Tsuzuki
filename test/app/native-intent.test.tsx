import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react-native';
import type * as Linking from 'expo-linking';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';

import {
  INCOMING_LINK_MAX_LENGTH,
  INCOMING_LINK_MAX_PERCENT_ESCAPES,
} from '../../src/core/schemas/incoming-link';
import * as NativeIntent from '../../app/+native-intent';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import { renderRouterAsync } from '../mobile/render-router';
import { APP_ROUTES } from './app-routes';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';

// no supabase client: the composition root gets a signed-out fake auth repository
jest.mock('@core/repositories/supabase/create-supabase-client', () =>
  jest
    .requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module')
    .fakeSupabaseClientModule(),
);
jest.mock('@core/repositories/supabase/auth-repository', () =>
  jest
    .requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module')
    .fakeSupabaseAuthModule(),
);

// the composition root gets a fake provider instead of the tenrai one: no http
jest.mock('@core/catalog/jikan/jikan-catalog-provider', () =>
  jest.requireActual<typeof FakeJikanModule>('../mobile/fake-jikan-module').fakeJikanModule(),
);

jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => [{ languageTag: 'en-US' }],
}));

const DISCOVER_TEST_ID = 'discover-screen';
const MEDIA_DETAIL_TEST_ID = 'media-detail-screen';
const MEDIA_PATH = '/media/mal/anime/52991';
const MEDIA_URL = `tsuzuki://media/mal/anime/52991`;

// a media path padded to exactly `length` code units
const mediaPathOfLength = (length: number) => {
  const prefix = `${MEDIA_PATH}?pad=`;
  return prefix + 'a'.repeat(length - prefix.length);
};

// a media path whose query holds `count` percent-encoded bytes
const mediaPathWithEscapes = (count: number) => `${MEDIA_PATH}?q=${'%41'.repeat(count)}`;

const TOO_LONG = mediaPathOfLength(INCOMING_LINK_MAX_LENGTH + 1);
const TOO_MANY_ESCAPES = mediaPathWithEscapes(INCOMING_LINK_MAX_PERCENT_ESCAPES + 1);

describe('redirectSystemPath', () => {
  it.each([MEDIA_URL, MEDIA_PATH, mediaPathOfLength(INCOMING_LINK_MAX_LENGTH)])(
    'passes the link %s through unchanged',
    (path) => {
      expect(NativeIntent.redirectSystemPath({ path, initial: true })).toBe(path);
      expect(NativeIntent.redirectSystemPath({ path, initial: false })).toBe(path);
    },
  );

  it.each([
    ['too long', TOO_LONG],
    ['with too many percent escapes', TOO_MANY_ESCAPES],
  ])('opens the home route instead of a link %s', (_, path) => {
    expect(NativeIntent.redirectSystemPath({ path, initial: true })).toBe('/');
    expect(NativeIntent.redirectSystemPath({ path, initial: false })).toBe('/');
  });
});

// expo-router applies the native intent to the initial link (getLinkingConfig, getInitialURL) and
// to the links received while the app runs (link/linking.js, subscribe), before getStateFromPath
// parses them
describe('the native intent in the router', () => {
  it('opens a normal initial link', async () => {
    const router = await renderRouterAsync(APP_ROUTES, { initialUrl: MEDIA_PATH });

    expect(screen.getByTestId(MEDIA_DETAIL_TEST_ID)).toBeOnTheScreen();
    expect(router.getPathname()).toBe(MEDIA_PATH);
  });

  it.each([
    ['too long', TOO_LONG],
    ['with too many percent escapes', TOO_MANY_ESCAPES],
  ])('opens Discover instead of an initial link %s', async (_, url) => {
    const router = await renderRouterAsync(APP_ROUTES, { initialUrl: url });

    expect(screen.getByTestId(DISCOVER_TEST_ID)).toBeOnTheScreen();
    expect(screen.queryByTestId(MEDIA_DETAIL_TEST_ID)).not.toBeOnTheScreen();
    expect(router.getPathname()).toBe('/');
  });

  describe('a link received while the app runs', () => {
    let receive: (url: string) => Promise<void>;

    beforeEach(() => {
      const listeners: ((event: { url: string }) => unknown)[] = [];
      // the mocked module object the router requires (expo-router/testing-library mocks
      // expo-linking): a namespace import is a copy, so a spy on it would not reach the router
      const linkingModule = jest.requireMock<typeof Linking>('expo-linking');
      jest.spyOn(linkingModule, 'addEventListener').mockImplementation((_type, listener) => {
        listeners.push(listener);
        return { remove: jest.fn() } as unknown as ReturnType<typeof Linking.addEventListener>;
      });
      receive = async (url) => {
        await act(async () => {
          expect(listeners).not.toHaveLength(0);
          await Promise.all(listeners.map((listener) => listener({ url })));
        });
      };
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('opens a normal link', async () => {
      const router = await renderRouterAsync(APP_ROUTES, { initialUrl: '/' });

      await receive(MEDIA_PATH);

      expect(screen.getByTestId(MEDIA_DETAIL_TEST_ID)).toBeOnTheScreen();
      expect(router.getPathname()).toBe(MEDIA_PATH);
    });

    it.each([
      ['too long', TOO_LONG],
      ['with too many percent escapes', TOO_MANY_ESCAPES],
    ])('opens Discover instead of a link %s', async (_, url) => {
      const router = await renderRouterAsync(APP_ROUTES, { initialUrl: '/' });

      await receive(url);

      expect(screen.queryByTestId(MEDIA_DETAIL_TEST_ID)).not.toBeOnTheScreen();
      expect(router.getPathname()).toBe('/');
    });
  });
});
