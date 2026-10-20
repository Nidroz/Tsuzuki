import { SCORE_MAX, SCORE_MIN } from '@core/domain/library-entry';
import { useTranslation } from '@core/i18n/index';
import { RadioGroup, Sheet, type RadioOption } from '@ui/index';
import { useMemo } from 'react';

import { SheetActions } from './SheetActions';
import { useSheetDraft } from './use-sheet-draft';

const TEST_ID = 'media-detail-library-score-sheet';

// the radio value of no score: radio values are strings, a score its digits
const NO_SCORE = 'none';

// every valid score, SCORE_MIN to SCORE_MAX (BR-07)
const SCORES: readonly number[] = Array.from(
  { length: SCORE_MAX - SCORE_MIN + 1 },
  (_, index) => SCORE_MIN + index,
);

const radioValueOf = (score: number | null): string => (score === null ? NO_SCORE : String(score));

// only the values of the options below reach onChange
const scoreOf = (value: string): number | null => (value === NO_SCORE ? null : Number(value));

export interface ScoreSheetProps {
  visible: boolean;
  /** the entry's score, null for none: each opening starts a draft from it */
  score: number | null;
  /** called with a changed score only, null to clear it */
  onSave: (score: number | null) => void;
  /** closes the sheet; without Save the draft is discarded */
  onClose: () => void;
}

/** the score sheet of a library entry (FR-13): "No score", then one radio per score, 1 to 10 */
export function ScoreSheet({ visible, score, onSave, onClose }: ScoreSheetProps) {
  const { t, formatNumber } = useTranslation();
  const [draft, setDraft] = useSheetDraft(visible, score);
  const options = useMemo<readonly RadioOption<string>[]>(
    () => [
      { value: NO_SCORE, label: t('library.score.none') },
      ...SCORES.map((value) => ({
        value: String(value),
        label: t('library.score.value', {
          score: formatNumber(value),
          max: formatNumber(SCORE_MAX),
        }),
      })),
    ],
    [t, formatNumber],
  );

  const choose = (value: string) => {
    setDraft(scoreOf(value));
  };
  const save = () => {
    if (draft !== score) {
      onSave(draft);
    }
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={t('mediaDetail.library.score.title')}
      closeLabel={t('mediaDetail.library.score.close')}
      onClose={onClose}
      footer={
        <SheetActions
          confirmLabel={t('mediaDetail.library.save')}
          onConfirm={save}
          onCancel={onClose}
          testID={TEST_ID}
        />
      }
      testID={TEST_ID}
    >
      <RadioGroup
        accessibilityLabel={t('mediaDetail.library.score.title')}
        options={options}
        value={radioValueOf(draft)}
        onChange={choose}
        testID="media-detail-library-score-options"
      />
    </Sheet>
  );
}
