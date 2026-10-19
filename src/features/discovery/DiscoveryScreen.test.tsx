import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent, within } from '@testing-library/react-native';

import {
  advance,
  foregroundSeasons,
  foregroundTops,
  renderDiscoveryScreen,
} from '../../../test/mobile/render-discovery-screen';
import { rowOf } from './__fixtures__/discovery-pages';

// fR-05: the sections of the discovery screen and the manga formats

// the screen pushes the detail route when a row is opened (DiscoveryScreen.open.test.tsx)
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ push: jest.fn() }),
}));

const SECTION_LABELS = ['Top anime', 'Top manga', 'This season'];
const FORMAT_LABELS = [
  'All',
  'Manga',
  'Manhwa',
  'Manhua',
  'Light novel',
  'Novel',
  'One-shot',
  'Doujinshi',
];

const SECTIONS_TEST_ID = 'discover-section';
const FORMATS_TEST_ID = 'discover-format';

// the accessible names of the chips of a chip group
const chipNames = (testID: string) =>
  within(screen.getByTestId(testID))
    .getAllByRole('radio')
    .map((chip) => chip.props.accessibilityLabel as unknown);

// a chip group is announced with its name
const expectGroup = (testID: string, name: string) => {
  const group = screen.getByTestId(testID);
  expect(group).toHaveProp('accessibilityRole', 'radiogroup');
  expect(group).toHaveProp('accessibilityLabel', name);
};

describe('DiscoveryScreen', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it('shows the labelled section chips, top anime checked, without the format chips', async () => {
    await renderDiscoveryScreen();
    await advance(0);

    expect(screen.getByTestId('discover-screen')).toBeOnTheScreen();
    expectGroup(SECTIONS_TEST_ID, 'Lists');
    expect(chipNames(SECTIONS_TEST_ID)).toStrictEqual(SECTION_LABELS);
    expect(screen.getByRole('radio', { name: 'Top anime' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Top manga' })).not.toBeChecked();
    expect(screen.queryByTestId(FORMATS_TEST_ID)).not.toBeOnTheScreen();
  });

  it('loads page 1 of the top anime on mount, not the other sections', async () => {
    const { provider } = await renderDiscoveryScreen();
    await advance(0);

    expect(foregroundTops(provider)).toStrictEqual([{ kind: 'anime', page: 1 }]);
    expect(provider.getTop).toHaveBeenCalledWith(
      { kind: 'anime', page: 1 },
      expect.any(AbortSignal),
    );
    expect(screen.getByTestId(rowOf('anime', 1))).toBeOnTheScreen();
    expect(provider.getCurrentSeason).not.toHaveBeenCalled();
  });

  it('shows the first-load spinner until the first page arrives', async () => {
    await renderDiscoveryScreen({ getTop: () => new Promise(() => undefined) });
    await advance(0);

    expect(screen.getByRole('progressbar', { name: 'Loading results' })).toBeOnTheScreen();
  });

  it('shows the format chips on top manga, all checked, and loads every manga format', async () => {
    const { provider } = await renderDiscoveryScreen();
    await advance(0);

    await user.press(screen.getByRole('radio', { name: 'Top manga' }));
    await advance(0);

    expect(screen.getByRole('radio', { name: 'Top manga' })).toBeChecked();
    expectGroup(FORMATS_TEST_ID, 'Manga format');
    expect(chipNames(FORMATS_TEST_ID)).toStrictEqual(FORMAT_LABELS);
    expect(screen.getByTestId('discover-format-all')).toBeChecked();
    expect(foregroundTops(provider)).toStrictEqual([
      { kind: 'anime', page: 1 },
      { kind: 'manga', page: 1 },
    ]);
    expect(screen.getByTestId(rowOf('manga', 1))).toBeOnTheScreen();
  });

  it('loads page 1 of the manhwa top list when manhwa is chosen', async () => {
    const { provider } = await renderDiscoveryScreen();
    await advance(0);
    await user.press(screen.getByRole('radio', { name: 'Top manga' }));
    await advance(0);

    await user.press(screen.getByTestId('discover-format-manhwa'));
    await advance(0);

    expect(screen.getByTestId('discover-format-manhwa')).toBeChecked();
    expect(screen.getByTestId('discover-format-all')).not.toBeChecked();
    expect(foregroundTops(provider).at(-1)).toStrictEqual({
      kind: 'manga',
      format: 'manhwa',
      page: 1,
    });
    expect(provider.getTop).toHaveBeenCalledWith(
      { kind: 'manga', format: 'manhwa', page: 1 },
      expect.any(AbortSignal),
    );
  });

  it('shows every manga format again when all is chosen after a format', async () => {
    await renderDiscoveryScreen();
    await advance(0);
    await user.press(screen.getByRole('radio', { name: 'Top manga' }));
    await advance(0);
    await user.press(screen.getByTestId('discover-format-manhwa'));
    await advance(0);

    await user.press(screen.getByRole('radio', { name: 'All' }));
    await advance(0);

    expect(screen.getByTestId('discover-format-all')).toBeChecked();
    expect(screen.getByTestId('discover-format-manhwa')).not.toBeChecked();
    expect(screen.getByTestId(rowOf('manga', 1))).toBeOnTheScreen();
  });

  it('keeps the chosen manga format while another section is shown', async () => {
    const { provider } = await renderDiscoveryScreen();
    await advance(0);
    await user.press(screen.getByRole('radio', { name: 'Top manga' }));
    await advance(0);
    await user.press(screen.getByTestId('discover-format-manhwa'));
    await advance(0);

    await user.press(screen.getByRole('radio', { name: 'Top anime' }));
    await advance(0);

    expect(screen.queryByTestId(FORMATS_TEST_ID)).not.toBeOnTheScreen();
    expect(screen.getByTestId(rowOf('anime', 1))).toBeOnTheScreen();

    await user.press(screen.getByRole('radio', { name: 'Top manga' }));
    await advance(0);

    expect(screen.getByTestId('discover-format-manhwa')).toBeChecked();
    expect(screen.getByTestId(rowOf('manga', 1))).toBeOnTheScreen();
    expect(foregroundTops(provider)).toStrictEqual([
      { kind: 'anime', page: 1 },
      { kind: 'manga', page: 1 },
      { kind: 'manga', format: 'manhwa', page: 1 },
    ]);
  });

  it('loads page 1 of the current season on this season, without the format chips', async () => {
    const { provider } = await renderDiscoveryScreen();
    await advance(0);

    await user.press(screen.getByRole('radio', { name: 'This season' }));
    await advance(0);

    expect(screen.getByRole('radio', { name: 'This season' })).toBeChecked();
    expect(screen.queryByTestId(FORMATS_TEST_ID)).not.toBeOnTheScreen();
    expect(foregroundSeasons(provider)).toStrictEqual([1]);
    expect(provider.getCurrentSeason).toHaveBeenCalledWith(1, expect.any(AbortSignal));
    expect(screen.getByTestId(rowOf('season', 1))).toBeOnTheScreen();
  });

  it('labels the sections and the formats in french', async () => {
    await renderDiscoveryScreen({ language: 'fr' });
    await advance(0);

    expectGroup(SECTIONS_TEST_ID, 'Listes');
    expect(screen.getByRole('radio', { name: 'Cette saison' })).toBeOnTheScreen();

    await user.press(screen.getByRole('radio', { name: 'Top manga' }));
    await advance(0);

    expectGroup(FORMATS_TEST_ID, 'Format du manga');
    expect(screen.getByRole('radio', { name: 'Tous' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Roman' })).toBeOnTheScreen();
  });
});
