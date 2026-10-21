import type { MediaDetail } from '@core/catalog/catalog-provider';
import type { Language } from '@core/i18n/index';
import { describe, expect, it } from '@jest/globals';
import { screen, within } from '@testing-library/react-native';
import { Text } from '@ui/index';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { BERSERK_DETAIL, FRIEREN_DETAIL, SOLO_LEVELING_DETAIL } from './__fixtures__/media-details';
import { MediaDetailContent } from './MediaDetailContent';

const COVER_TEST_ID = 'media-detail-cover';

const renderContent = (media: MediaDetail, language: Language = 'en') =>
  renderWithProviders(<MediaDetailContent media={media} />, { language });

const coverImage = () =>
  screen.queryByTestId(`${COVER_TEST_ID}-image`, { includeHiddenElements: true });
const coverPlaceholder = () =>
  screen.queryByTestId(`${COVER_TEST_ID}-placeholder`, { includeHiddenElements: true });
const fact = (testID: string) => screen.getByTestId(`media-detail-${testID}`);
// the test ids of the direct children of the content, in order
const contentOrder = () =>
  screen
    .getByTestId('media-detail-content')
    .children.filter((child) => typeof child !== 'string')
    .map((child) => child.props.testID as unknown);

describe('MediaDetailContent', () => {
  it('loads exactly the cover url of the detail, with no placeholder', async () => {
    await renderContent(FRIEREN_DETAIL);

    expect(coverImage()?.props.source).toStrictEqual([{ uri: FRIEREN_DETAIL.imageUrl }]);
    expect(coverPlaceholder()).not.toBeOnTheScreen();
  });

  it('shows the cover placeholder and no image without a cover url', async () => {
    await renderContent({ ...FRIEREN_DETAIL, imageUrl: null });

    expect(coverImage()).toBeNull();
    expect(coverPlaceholder()).not.toBeNull();
  });

  it('announces the title as a heading, with the english and native titles labelled', async () => {
    await renderContent(FRIEREN_DETAIL);

    expect(screen.getByRole('header', { name: 'Sousou no Frieren' })).toHaveProp(
      'testID',
      'media-detail-title',
    );
    expect(screen.getByLabelText("English title: Frieren: Beyond Journey's End")).toHaveTextContent(
      "Frieren: Beyond Journey's End",
    );
    expect(screen.getByLabelText('Native title: 葬送のフリーレン')).toHaveProp(
      'testID',
      'media-detail-title-native',
    );
  });

  it('leaves out an english title equal to the title ignoring case, and a missing native title', async () => {
    await renderContent({
      ...SOLO_LEVELING_DETAIL,
      titleEnglish: 'SOLO LEVELING',
      titleNative: null,
    });

    expect(screen.getByTestId('media-detail-title')).toHaveTextContent('Solo Leveling');
    expect(screen.queryByTestId('media-detail-title-english')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('media-detail-title-native')).not.toBeOnTheScreen();
    expect(screen.queryByText('SOLO LEVELING')).not.toBeOnTheScreen();
  });

  it('reads each fact as one element, "label, value"', async () => {
    await renderContent(FRIEREN_DETAIL);

    expect(screen.getByLabelText('Format, TV')).toHaveProp('testID', 'media-detail-format');
    expect(screen.getByLabelText('Status, Finished')).toHaveProp('testID', 'media-detail-status');
    expect(screen.getByLabelText('Episodes, 28')).toHaveProp('testID', 'media-detail-total-units');
    expect(screen.getByLabelText('Score, 9.24')).toHaveProp('testID', 'media-detail-score');
    // a year has no digit grouping
    expect(screen.getByLabelText('Year, 2023')).toHaveProp('testID', 'media-detail-year');
  });

  it.each<[string, MediaDetail, string]>([
    ['an airing anime', { ...FRIEREN_DETAIL, status: 'ongoing' }, 'Airing'],
    ['a publishing manga', BERSERK_DETAIL, 'Publishing'],
    ['an anime on hiatus', { ...FRIEREN_DETAIL, status: 'hiatus' }, 'On hiatus'],
    ['an upcoming manga', { ...BERSERK_DETAIL, status: 'upcoming' }, 'Upcoming'],
  ])('names the status of %s', async (_case, media, status) => {
    await renderContent(media);

    expect(fact('status')).toHaveTextContent(`Status${status}`);
  });

  it.each<[string, MediaDetail, string]>([
    ['one episode', { ...FRIEREN_DETAIL, totalUnits: 1 }, 'Episodes, 1'],
    ['many episodes, grouped', { ...FRIEREN_DETAIL, totalUnits: 1100 }, 'Episodes, 1,100'],
    ['the chapters of a manga', SOLO_LEVELING_DETAIL, 'Chapters, 201'],
    ['an unknown number of chapters', BERSERK_DETAIL, 'Chapters, Unknown'],
    ['an unknown number of episodes', { ...FRIEREN_DETAIL, totalUnits: null }, 'Episodes, Unknown'],
  ])('labels and writes the total units of %s', async (_case, media, fact) => {
    await renderContent(media);

    expect(screen.getByLabelText(fact)).toHaveProp('testID', 'media-detail-total-units');
  });

  it('writes a missing score and year as not scored and unknown', async () => {
    await renderContent({ ...FRIEREN_DETAIL, score: null, year: null });

    expect(screen.getByLabelText('Score, Not scored')).toBeOnTheScreen();
    expect(screen.getByLabelText('Year, Unknown')).toBeOnTheScreen();
  });

  it('names the format of a manga', async () => {
    await renderContent(SOLO_LEVELING_DETAIL);

    expect(screen.getByLabelText('Format, Manhwa')).toBeOnTheScreen();
  });

  it('shows the library slot right under the cover and titles, before the facts', async () => {
    await renderWithProviders(
      <MediaDetailContent
        media={FRIEREN_DETAIL}
        library={<Text testID="library-slot">library</Text>}
      />,
    );

    expect(contentOrder().slice(1, 2)).toStrictEqual(['library-slot']);
    expect(screen.getByTestId('media-detail-content')).toContainElement(
      screen.getByTestId('library-slot'),
    );
  });

  it('shows no library slot by default', async () => {
    await renderContent(FRIEREN_DETAIL);

    expect(contentOrder()).toStrictEqual([
      undefined,
      undefined,
      'media-detail-genres',
      'media-detail-synopsis',
    ]);
  });

  it('lists the genres and the synopsis under their headings', async () => {
    await renderContent(FRIEREN_DETAIL);

    const genres = screen.getByTestId('media-detail-genres');
    expect(within(genres).getByRole('header', { name: 'Genres' })).toBeOnTheScreen();
    for (const genre of FRIEREN_DETAIL.genres) {
      expect(within(genres).getByText(genre.name)).toBeOnTheScreen();
    }
    // static chips: nothing to press
    expect(within(genres).queryByRole('button')).not.toBeOnTheScreen();

    const synopsis = screen.getByTestId('media-detail-synopsis');
    expect(within(synopsis).getByRole('header', { name: 'Synopsis' })).toBeOnTheScreen();
    expect(within(synopsis).getByText('Placeholder synopsis.')).toBeOnTheScreen();
  });

  it('says so without genres or synopsis', async () => {
    await renderContent({ ...FRIEREN_DETAIL, genres: [], synopsis: null });

    expect(
      within(screen.getByTestId('media-detail-genres')).getByText('No genres'),
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('media-detail-synopsis')).getByText('No synopsis available'),
    ).toBeOnTheScreen();
  });

  it('is translated and formatted in french', async () => {
    await renderContent({ ...FRIEREN_DETAIL, status: 'ongoing' }, 'fr');

    expect(screen.getByLabelText('Statut, En cours de diffusion')).toBeOnTheScreen();
    expect(screen.getByLabelText('Épisodes, 28')).toBeOnTheScreen();
    expect(screen.getByLabelText('Note, 9,24')).toBeOnTheScreen();
    // no digit grouping either, where french would write 2 023
    expect(screen.getByLabelText('Année, 2023')).toBeOnTheScreen();
    expect(screen.getByLabelText('Titre original : 葬送のフリーレン')).toBeOnTheScreen();
  });

  it('writes the missing facts of a manga in french', async () => {
    await renderContent({ ...BERSERK_DETAIL, score: null, genres: [], synopsis: null }, 'fr');

    expect(screen.getByLabelText('Statut, En cours de publication')).toBeOnTheScreen();
    expect(screen.getByLabelText('Chapitres, Inconnu')).toBeOnTheScreen();
    expect(screen.getByLabelText('Note, Non noté')).toBeOnTheScreen();
    expect(screen.getByText('Aucun genre')).toBeOnTheScreen();
    expect(screen.getByText('Aucun synopsis disponible')).toBeOnTheScreen();
  });
});
