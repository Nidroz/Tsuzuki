import { MEDIA_KINDS, type MediaKind } from '@core/domain/media';
import { useTranslation, type TranslationKey } from '@core/i18n/index';
import { Chip, Row } from '@ui/index';

const KIND_KEYS = {
  anime: 'media.kind.anime',
  manga: 'media.kind.manga',
} as const satisfies Record<MediaKind, TranslationKey>;

export interface SearchKindSwitchProps {
  kind: MediaKind;
  onChange: (kind: MediaKind) => void;
}

/** the kind searched, anime or manga: one chip per kind, exactly one selected */
export function SearchKindSwitch({ kind, onChange }: SearchKindSwitchProps) {
  const { t } = useTranslation();

  return (
    <Row gap="sm" testID="search-kind">
      {MEDIA_KINDS.map((option) => (
        <Chip
          key={option}
          label={t(KIND_KEYS[option])}
          selected={option === kind}
          onPress={() => {
            onChange(option);
          }}
          testID={`search-kind-${option}`}
        />
      ))}
    </Row>
  );
}
