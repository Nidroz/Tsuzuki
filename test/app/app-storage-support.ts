// the launches of the composition root over the in-memory device of the app storage tests
// (src/platform/__fixtures__/app-storage-device.ts: mmkv files per instance id with the key that
// wrote them, the secure store), for the route tests of the app storage wiring (ADR-0020, R-09).
// a test file mocks react-native-mmkv and expo-secure-store with that device through a binding
// named mock... imported first, so every module registry, an isolated one included, gets the same
// files: loading the layout module again in jest.isolateModules is the next launch
import { createLocalDevicePurgeMarkerRepository } from '@core/repositories/local/device-purge-marker-repository';
import type { DevicePurgeMarker } from '@core/repositories/device-purge-marker-repository';
import type { SessionStorage } from '@core/repositories/session-storage';
import { jest } from '@jest/globals';
import { fileValues, seedFile, seedSecureItem } from '@platform/__fixtures__/app-storage-device';
import {
  APP_STORAGE_INSTANCE_ID,
  KEY_CHECK_KEY,
  KEY_CHECK_VALUE,
  MIGRATED_MARKER_KEY,
  MIGRATED_MARKER_VALUE,
} from '@platform/app-storage-instance';
import { APP_STORAGE_KEY_NAME } from '@platform/app-storage-key';
import { createSecureDocumentStorage } from '@platform/secure-documents';
import type * as TestingLibrary from '@testing-library/react-native';

import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import type * as RenderRouter from '../mobile/render-router';
import type * as AppRoutes from './app-routes';

/** the key an earlier launch stored; a low-entropy placeholder of the key length */
export const STORED_KEY = 'K'.repeat(32);

/** placeholder user ids */
export const USER_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
export const USER_C = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';

/** the files and the key an earlier launch on the files left, holding `values` */
export const seedEarlierLaunch = (values: Readonly<Record<string, string>>): void => {
  seedSecureItem(APP_STORAGE_KEY_NAME, STORED_KEY);
  seedFile(APP_STORAGE_INSTANCE_ID, STORED_KEY, {
    [KEY_CHECK_KEY]: KEY_CHECK_VALUE,
    [MIGRATED_MARKER_KEY]: MIGRATED_MARKER_VALUE,
    ...values,
  });
};

/** what the encrypted instance holds now, its reserved keys included */
export const appFileValues = (): Record<string, string | number | boolean> | undefined =>
  fileValues(APP_STORAGE_INSTANCE_ID);

/** the purges owed to the files, in the secure store, read as the next launch reads them */
export const owedPurgesOnDevice = () =>
  createLocalDevicePurgeMarkerRepository(createSecureDocumentStorage(), {
    reporter: { captureError: jest.fn() },
  });

/** the owed purges in the secure store now */
export const storedOwedPurges = (): readonly DevicePurgeMarker[] => owedPurgesOnDevice().list();

const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket'] as const;

type SavedGlobals = readonly (readonly [string, PropertyDescriptor | undefined])[];

// the network globals expo's runtime may replace as a registry loads it
const saveNetworkGlobals = (): SavedGlobals =>
  NETWORK_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);

const restoreGlobals = (saved: SavedGlobals): void => {
  for (const [name, descriptor] of saved) {
    if (descriptor !== undefined) Object.defineProperty(globalThis, name, descriptor);
  }
};

/** one load of the layout module in its own module registry: what it gave the supabase client */
export interface IsolatedLaunch {
  readonly sessionStorage: SessionStorage;
}

/**
 * runs the top level of the root layout in a fresh module registry, as the next launch of the
 * app would: the device files and secure store outlive it. `beforeLoad` runs first, in that
 * registry (to set up its mocks). jest reuses in it every mock the main registry already made, so
 * a mock whose state matters (a wrapped real module) needs a test file whose main registry never
 * loads the layout. the network globals expo's runtime may replace are restored
 */
export const launchInIsolation = (beforeLoad?: () => void): IsolatedLaunch => {
  const network = saveNetworkGlobals();
  const launched: { value?: IsolatedLaunch } = {};
  try {
    jest.isolateModules(() => {
      beforeLoad?.();
      jest.requireActual('../../app/_layout');
      const client = jest.requireMock<FakeSupabaseModule.FakeSupabaseClientModule>(
        '@core/repositories/supabase/create-supabase-client',
      ).createSupabaseClient;
      // the last call: a registry reuses the mocks the main registry made (a rendered launch)
      const config = client.mock.calls.at(-1)?.[0];
      if (config === undefined) throw new Error('the layout created no supabase client');
      launched.value = { sessionStorage: config.sessionStorage };
    });
  } finally {
    restoreGlobals(network);
  }
  if (launched.value === undefined) throw new Error('the isolated registry launched nothing');
  return launched.value;
};

/** a launch rendered in its own module registry, as `run` of renderLaunchInIsolation gets it */
export interface RenderedLaunch {
  /** the testing library of that registry: its `screen`, `act` and `userEvent` */
  readonly testing: typeof TestingLibrary;
  /** the mocked supabase auth module of that registry: its session and its users gone */
  readonly auth: FakeSupabaseModule.FakeSupabaseAuthModule;
}

// the testing library adds its cleanup hooks as it loads, which jest refuses inside a test: the
// launch unmounts itself instead, and sets the act environment those hooks would have set
const SKIP_AUTO_CLEANUP = 'RNTL_SKIP_AUTO_CLEANUP';
const ACT_ENVIRONMENT = 'IS_REACT_ACT_ENVIRONMENT';

/**
 * renders the app at `initialUrl` in a fresh module registry, as a launch of the app would (the
 * device files and secure store outlive it), runs `beforeRender` (to restore a session) then
 * `run` against it, and unmounts it: the process ends there, whatever is still pending. both run
 * inside that registry: a module they require (jest.requireActual) is that launch's, as an error
 * class the app compares must be. each launch gets its own react, router and testing library, so
 * a test file using it must load none of them in its main registry (no runtime import of the
 * testing library, the router or the layout): a mock the main registry made would be shared with
 * every launch
 */
export const renderLaunchInIsolation = async (
  initialUrl: string,
  run: (launch: RenderedLaunch) => Promise<void>,
  beforeRender?: (launch: RenderedLaunch) => void,
): Promise<void> => {
  const saved = saveNetworkGlobals();
  const actEnvironment = Object.getOwnPropertyDescriptor(globalThis, ACT_ENVIRONMENT);
  const skipAutoCleanup = process.env[SKIP_AUTO_CLEANUP];
  process.env[SKIP_AUTO_CLEANUP] = 'true';
  Object.defineProperty(globalThis, ACT_ENVIRONMENT, {
    value: true,
    writable: true,
    configurable: true,
  });
  try {
    await jest.isolateModulesAsync(async () => {
      const testing = jest.requireActual<typeof TestingLibrary>('@testing-library/react-native');
      const { renderRouterAsync } =
        jest.requireActual<typeof RenderRouter>('../mobile/render-router');
      const auth = jest.requireMock<FakeSupabaseModule.FakeSupabaseAuthModule>(
        '@core/repositories/supabase/auth-repository',
      );
      const launch: RenderedLaunch = { testing, auth };
      beforeRender?.(launch);
      const { APP_ROUTES } = jest.requireActual<typeof AppRoutes>('./app-routes');
      await renderRouterAsync(APP_ROUTES, { initialUrl });
      try {
        await run(launch);
      } finally {
        await testing.screen.unmount();
      }
    });
  } finally {
    if (skipAutoCleanup === undefined) {
      Reflect.deleteProperty(process.env, SKIP_AUTO_CLEANUP);
    } else {
      process.env[SKIP_AUTO_CLEANUP] = skipAutoCleanup;
    }
    if (actEnvironment === undefined) {
      Reflect.deleteProperty(globalThis, ACT_ENVIRONMENT);
    } else {
      Object.defineProperty(globalThis, ACT_ENVIRONMENT, actEnvironment);
    }
    restoreGlobals(saved);
  }
};
