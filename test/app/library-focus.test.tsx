import { LibraryContextProvider } from '@core/hooks/LibraryContextProvider';
import { describe, expect, it } from '@jest/globals';
import { userEvent } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';
import type { ComponentType, ReactNode } from 'react';

import { LIBRARY } from '../../src/features/library/__fixtures__/library-entries';
import { createFakeLibraryRepository } from '../core/fake-library-repository';
import { settle } from '../mobile/render-library-screen';
import { renderRouterAsync } from '../mobile/render-router';
import { providersFor } from '../mobile/render-with-providers';
import { APP_ROUTES } from './app-routes';

// fR-14, BR-02: the library tab keeps the layout while the user acts on it, and lays the list out
// again when the tab gains focus: the real tab navigator fires useFocusEffect

// the tabs group of the app routes, without the root layout
const ROUTES = Object.fromEntries(
  Object.entries(APP_ROUTES).filter(([name]) => name.startsWith('(tabs)/')),
);

// the library tab reads the library: the root layout owns it (root-layout-library.test.tsx)
const withLibrary = (): ComponentType<{ readonly children: ReactNode }> => {
  const Providers = providersFor();
  const repository = createFakeLibraryRepository(LIBRARY);
  return function LibraryProviders({ children }) {
    return (
      <Providers>
        <LibraryContextProvider repository={repository}>{children}</LibraryContextProvider>
      </Providers>
    );
  };
};

const header = (name: string) => screen.queryByRole('header', { name });

describe('library tab focus (FR-14)', () => {
  it('moves a planned entry turned current only once the tab gains focus again (BR-02)', async () => {
    const user = userEvent.setup();
    await renderRouterAsync(ROUTES, { initialUrl: '/library', wrapper: withLibrary() });
    await settle();

    await user.press(screen.getByRole('button', { name: 'Add one episode, Monster' }));

    expect(header('Planned (1)')).toBeOnTheScreen();
    expect(header('In progress (2)')).toBeOnTheScreen();

    await user.press(screen.getByTestId('tab-favorites'));
    await user.press(screen.getByTestId('tab-library'));

    expect(header('In progress (3)')).toBeOnTheScreen();
    expect(header('Planned (1)')).not.toBeOnTheScreen();
  });
});
