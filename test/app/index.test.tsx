import { describe, expect, it } from '@jest/globals';
import { screen } from 'expo-router/testing-library';

import IndexScreen from '../../app/index';
import { renderRouterAsync } from '../mobile/render-router';

const ROOT_PATHNAME = '/';
const HOME_SCREEN_TEST_ID = 'home-screen';

describe('index route', () => {
  it('renders the home screen at the root pathname', async () => {
    const router = await renderRouterAsync({ index: IndexScreen });

    expect(router.getPathname()).toBe(ROOT_PATHNAME);
    expect(screen.getByTestId(HOME_SCREEN_TEST_ID)).toBeOnTheScreen();
  });
});
