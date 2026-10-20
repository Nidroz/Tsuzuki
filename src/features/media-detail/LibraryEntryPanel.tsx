import type { LibraryEntry } from '@core/domain/library-entry';
import { SCORE_MAX } from '@core/domain/library-entry';
import { canIncrementProgress } from '@core/domain/library-progress';
import type { MediaKind } from '@core/domain/media';
import type { LibraryEntryActions } from '@core/hooks/use-library-entry-actions';
import { LIBRARY_STATUS_KEYS, PROGRESS_LABEL_KEYS, useTranslation } from '@core/i18n/index';
import { Button, Fact, IconButton, Row, Stack } from '@ui/index';
import { useCallback, useState, type ReactNode } from 'react';

import { NotesSheet } from './NotesSheet';
import { ProgressSheet } from './ProgressSheet';
import { RemoveSheet } from './RemoveSheet';
import { ScoreSheet } from './ScoreSheet';
import { StatusSheet } from './StatusSheet';

const TEST_ID = 'media-detail-library';

type SheetName = 'status' | 'progress' | 'score' | 'notes' | 'remove';

/** the actions the panel calls; the section shows the write errors */
export type LibraryEntryPanelActions = Pick<
  LibraryEntryActions,
  'remove' | 'setStatus' | 'setProgress' | 'incrementProgress' | 'setScore' | 'setNotes'
>;

export interface LibraryEntryPanelProps {
  /** the entry of the media, with the catalog's fresh snapshot (its total) applied */
  entry: LibraryEntry;
  /** words the status and the progress for an anime or a manga */
  kind: MediaKind;
  actions: LibraryEntryPanelActions;
}

interface LibraryFieldProps {
  label: string;
  value: string;
  /** the fact gets `${testID}`, read as "label, value" */
  testID: string;
  /** the buttons of the field */
  children: ReactNode;
}

// a fact of the entry with its buttons at the end of the row
function LibraryField({ label, value, testID, children }: LibraryFieldProps) {
  return (
    <Row gap="md" justify="between">
      <Stack gap="none" flex>
        <Fact label={label} value={value} testID={testID} />
      </Stack>
      <Row gap="xs">{children}</Row>
    </Row>
  );
}

/**
 * a media in the library (FR-10 to FR-13): its status, progress with the `+1` button (disabled at
 * the known total, BR-01), score and notes, each edited in a sheet that writes only on Save, and
 * its removal after a confirmation. every write is a user tap
 */
export function LibraryEntryPanel({ entry, kind, actions }: LibraryEntryPanelProps) {
  const { t, formatNumber } = useTranslation();
  const [openSheet, setOpenSheet] = useState<SheetName | null>(null);
  const close = useCallback(() => {
    setOpenSheet(null);
  }, []);
  const editButton = (sheet: SheetName, accessibilityLabel: string) => (
    <Button
      label={t('mediaDetail.library.edit')}
      accessibilityLabel={accessibilityLabel}
      variant="secondary"
      onPress={() => {
        setOpenSheet(sheet);
      }}
      testID={`${TEST_ID}-${sheet}-edit`}
    />
  );

  const progressKeys = PROGRESS_LABEL_KEYS[kind];
  const total = entry.media.totalUnits;
  const progress = formatNumber(entry.progress);
  const progressText =
    total === null
      ? t(progressKeys.alone, { progress, count: entry.progress })
      : t(progressKeys.ofTotal, { progress, total: formatNumber(total), count: total });
  const scoreText =
    entry.score === null
      ? t('library.score.none')
      : t('library.score.value', {
          score: formatNumber(entry.score),
          max: formatNumber(SCORE_MAX),
        });

  return (
    <Stack gap="md">
      <LibraryField
        label={t('mediaDetail.library.status.title')}
        value={t(LIBRARY_STATUS_KEYS[kind][entry.status])}
        testID={`${TEST_ID}-status`}
      >
        {editButton('status', t('mediaDetail.library.status.editLabel'))}
      </LibraryField>
      <LibraryField
        label={t('mediaDetail.library.progress.title')}
        value={progressText}
        testID={`${TEST_ID}-progress`}
      >
        <IconButton
          icon="add"
          accessibilityLabel={t(progressKeys.increment)}
          onPress={actions.incrementProgress}
          disabled={!canIncrementProgress(entry)}
          testID={`${TEST_ID}-progress-increment`}
        />
        {editButton('progress', t('mediaDetail.library.progress.editLabel'))}
      </LibraryField>
      <LibraryField
        label={t('mediaDetail.library.score.title')}
        value={scoreText}
        testID={`${TEST_ID}-score`}
      >
        {editButton('score', t('mediaDetail.library.score.editLabel'))}
      </LibraryField>
      <LibraryField
        label={t('mediaDetail.library.notes.title')}
        value={entry.notes ?? t('library.notes.none')}
        testID={`${TEST_ID}-notes`}
      >
        {editButton('notes', t('mediaDetail.library.notes.editLabel'))}
      </LibraryField>
      <Button
        label={t('mediaDetail.library.remove.action')}
        variant="secondary"
        onPress={() => {
          setOpenSheet('remove');
        }}
        testID={`${TEST_ID}-remove`}
      />

      <StatusSheet
        visible={openSheet === 'status'}
        kind={kind}
        status={entry.status}
        onSave={actions.setStatus}
        onClose={close}
      />
      <ProgressSheet
        visible={openSheet === 'progress'}
        kind={kind}
        progress={entry.progress}
        totalUnits={total}
        onSave={actions.setProgress}
        onClose={close}
      />
      <ScoreSheet
        visible={openSheet === 'score'}
        score={entry.score}
        onSave={actions.setScore}
        onClose={close}
      />
      <NotesSheet
        visible={openSheet === 'notes'}
        notes={entry.notes}
        onSave={actions.setNotes}
        onClose={close}
      />
      <RemoveSheet visible={openSheet === 'remove'} onConfirm={actions.remove} onClose={close} />
    </Stack>
  );
}
