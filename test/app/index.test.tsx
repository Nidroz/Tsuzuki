import { describe, expect, it } from '@jest/globals';
import { screen } from 'expo-router/testing-library';

import IndexScreen from '../../app/index';
import en from '../../src/core/i18n/en.json';
import fr from '../../src/core/i18n/fr.json';
import { renderRouterAsync } from '../mobile/render-router';
import { providersFor } from '../mobile/render-with-providers';

const ROOT_PATHNAME = '/';
const HOME_SCREEN_TEST_ID = 'home-screen';

describe('index route', () => {
  it('renders the home screen at the root pathname', async () => {
    const router = await renderRouterAsync({ index: IndexScreen }, { wrapper: providersFor() });

    expect(router.getPathname()).toBe(ROOT_PATHNAME);
    expect(screen.getByTestId(HOME_SCREEN_TEST_ID)).toBeOnTheScreen();
  });

  it('shows the home title in english', async () => {
    await renderRouterAsync({ index: IndexScreen }, { wrapper: providersFor('en') });

    expect(screen.getByText(en.home.title)).toBeOnTheScreen();
    expect(screen.queryByText(fr.home.title)).not.toBeOnTheScreen();
  });

  it('shows the home title in french', async () => {
    await renderRouterAsync({ index: IndexScreen }, { wrapper: providersFor('fr') });

    expect(screen.getByText(fr.home.title)).toBeOnTheScreen();
    expect(screen.queryByText(en.home.title)).not.toBeOnTheScreen();
  });
});
