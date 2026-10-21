import type { MediaSummary } from '@core/catalog/catalog-provider';
import { DEFAULT_SHOW_ADULT } from '@core/domain/content-filter';
import { SEARCHABLE_MANGA_FORMATS, type SearchableMangaFormat } from '@core/domain/media';
import { FORMAT_KEYS, useTranslation, type TranslationKey } from '@core/i18n/index';
import { toMediaRouteParams } from '@core/schemas/media-route-params';
import { ChoiceChips, type ChoiceChipOption } from '@features/media-list/ChoiceChips';
import { Screen, Stack, type ScreenEdge } from '@ui/index';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import type { DiscoveryListProps } from './DiscoveryPageList';
import { SeasonSection } from './SeasonSection';
import { TopMediaSection } from './TopMediaSection';

// under the navigator header and above the tab bar: only the sides need the safe area
const EDGES: readonly ScreenEdge[] = ['left', 'right'];

const SECTIONS = ['topAnime', 'topManga', 'season'] as const;
type DiscoverySection = (typeof SECTIONS)[number];

const SECTION_KEYS = {
  topAnime: 'discovery.sections.topAnime',
  topManga: 'discovery.sections.topManga',
  season: 'discovery.sections.season',
} as const satisfies Record<DiscoverySection, TranslationKey>;

const DEFAULT_SECTION: DiscoverySection = 'topAnime';
// the chip of every manga format: not a format, so it never collides with one
const ALL_FORMATS = 'all';
type FormatChoice = SearchableMangaFormat | typeof ALL_FORMATS;

const FIRST_PAGE = 1;
const MEDIA_DETAIL_PATHNAME = '/media/[namespace]/[kind]/[id]';

// TODO(L-06): read the adult content setting
const SHOW_ADULT = DEFAULT_SHOW_ADULT;

/** the page requested, with the list it belongs to */
interface RequestedPage {
  readonly list: string;
  readonly page: number;
}

/**
 * the discovery screen (FR-05, FR-04, BR-06): the top anime, the top manga of every format or of
 * one, and the titles of the current season, a page at a time. the manga format is kept while
 * another section is shown; the page belongs to its list
 */
export function DiscoveryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [section, setSection] = useState<DiscoverySection>(DEFAULT_SECTION);
  const [mangaFormat, setMangaFormat] = useState<SearchableMangaFormat | null>(null);

  // the page belongs to the list it was requested in (FR-04): another section or format starts
  // again at page 1. adjusted while rendering rather than in an effect, like the search page, so no
  // render ever pairs a new list with an old page
  const list = JSON.stringify([section, mangaFormat]);
  const [requested, setRequested] = useState<RequestedPage>({ list, page: FIRST_PAGE });
  if (requested.list !== list) {
    setRequested({ list, page: FIRST_PAGE });
  }
  const page = requested.list === list ? requested.page : FIRST_PAGE;
  const changePage = useCallback(
    (next: number) => {
      setRequested({ list, page: next });
    },
    [list],
  );

  const sectionOptions = useMemo<readonly ChoiceChipOption<DiscoverySection>[]>(
    () => SECTIONS.map((value) => ({ value, label: t(SECTION_KEYS[value]) })),
    [t],
  );
  const formatOptions = useMemo<readonly ChoiceChipOption<FormatChoice>[]>(
    () => [
      { value: ALL_FORMATS, label: t('discovery.formats.all') },
      ...SEARCHABLE_MANGA_FORMATS.map((value) => ({ value, label: t(FORMAT_KEYS[value]) })),
    ],
    [t],
  );

  const changeFormat = useCallback((choice: FormatChoice) => {
    setMangaFormat(choice === ALL_FORMATS ? null : choice);
  }, []);

  const open = useCallback(
    (item: MediaSummary) => {
      // spread: expo-router takes a record of params, which an interface type is not
      router.push({ pathname: MEDIA_DETAIL_PATHNAME, params: { ...toMediaRouteParams(item.key) } });
    },
    [router],
  );

  const listProps: DiscoveryListProps = {
    currentPage: page,
    onPageChange: changePage,
    onOpen: open,
    scrollToTopKey: `${list}#${String(page)}`,
  };

  return (
    <Screen edges={EDGES} testID="discover-screen">
      <Stack gap="md" flex>
        <ChoiceChips
          accessibilityLabel={t('discovery.sections.label')}
          options={sectionOptions}
          value={section}
          onChange={setSection}
          testID="discover-section"
        />
        {section === 'topManga' ? (
          <ChoiceChips
            accessibilityLabel={t('discovery.formats.label')}
            options={formatOptions}
            value={mangaFormat ?? ALL_FORMATS}
            onChange={changeFormat}
            testID="discover-format"
          />
        ) : null}
        {section === 'season' ? (
          <SeasonSection showAdult={SHOW_ADULT} {...listProps} />
        ) : (
          <TopMediaSection
            kind={section === 'topManga' ? 'manga' : 'anime'}
            format={section === 'topManga' ? mangaFormat : null}
            showAdult={SHOW_ADULT}
            {...listProps}
          />
        )}
      </Stack>
    </Screen>
  );
}
