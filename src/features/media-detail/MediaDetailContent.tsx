import type { MediaDetail } from '@core/catalog/catalog-provider';
import {
  englishTitleOf,
  FORMAT_KEYS,
  nativeTitleOf,
  STATUS_KEYS,
  TOTAL_UNITS_LABEL_KEYS,
  useTranslation,
  YEAR_FORMAT,
} from '@core/i18n/index';
import { Chip, CoverImage, Fact, Row, Stack, Text } from '@ui/index';

export interface MediaDetailContentProps {
  /** a visible media: never an adult title while the setting is off (BR-06) */
  media: MediaDetail;
}

/**
 * the details of a title (FR-06): its cover and titles, its facts (format, status, episodes or
 * chapters, score, year), its genres and its synopsis. provider text is shown as plain text
 */
export function MediaDetailContent({ media }: MediaDetailContentProps) {
  const { t, formatNumber } = useTranslation();
  const { kind } = media.key;
  const englishTitle = englishTitleOf(media);
  const nativeTitle = nativeTitleOf(media);
  const unknown = t('mediaDetail.facts.unknown');

  const totalUnits = media.totalUnits === null ? unknown : formatNumber(media.totalUnits);
  const score = media.score === null ? t('mediaDetail.facts.notScored') : formatNumber(media.score);
  const year = media.year === null ? unknown : formatNumber(media.year, YEAR_FORMAT);

  return (
    <Stack gap="lg" testID="media-detail-content">
      <Row gap="md" align="start">
        <CoverImage url={media.imageUrl} size="lg" testID="media-detail-cover" />
        <Stack gap="xs" flex>
          <Text variant="title" testID="media-detail-title">
            {media.title}
          </Text>
          {englishTitle === undefined ? null : (
            <Text
              tone="muted"
              accessibilityLabel={t('mediaDetail.titles.english', { title: englishTitle })}
              testID="media-detail-title-english"
            >
              {englishTitle}
            </Text>
          )}
          {nativeTitle === undefined ? null : (
            <Text
              tone="muted"
              accessibilityLabel={t('mediaDetail.titles.native', { title: nativeTitle })}
              testID="media-detail-title-native"
            >
              {nativeTitle}
            </Text>
          )}
        </Stack>
      </Row>

      <Stack gap="md">
        <Fact
          label={t('mediaDetail.facts.format')}
          value={t(FORMAT_KEYS[media.format])}
          testID="media-detail-format"
        />
        <Fact
          label={t('mediaDetail.facts.status')}
          value={t(STATUS_KEYS[kind][media.status])}
          testID="media-detail-status"
        />
        <Fact
          label={t(TOTAL_UNITS_LABEL_KEYS[kind])}
          value={totalUnits}
          testID="media-detail-total-units"
        />
        <Fact label={t('mediaDetail.facts.score')} value={score} testID="media-detail-score" />
        <Fact label={t('mediaDetail.facts.year')} value={year} testID="media-detail-year" />
      </Stack>

      <Stack gap="sm" testID="media-detail-genres">
        <Text variant="subtitle" heading>
          {t('mediaDetail.genres.title')}
        </Text>
        {media.genres.length === 0 ? (
          <Text tone="muted">{t('mediaDetail.genres.empty')}</Text>
        ) : (
          <Row gap="sm" wrap>
            {media.genres.map((genre) => (
              // no onPress: a static chip, one accessible element without a button role
              <Chip key={genre.id} label={genre.name} />
            ))}
          </Row>
        )}
      </Stack>

      <Stack gap="sm" testID="media-detail-synopsis">
        <Text variant="subtitle" heading>
          {t('mediaDetail.synopsis.title')}
        </Text>
        {media.synopsis === null ? (
          <Text tone="muted">{t('mediaDetail.synopsis.empty')}</Text>
        ) : (
          <Text>{media.synopsis}</Text>
        )}
      </Stack>
    </Stack>
  );
}
