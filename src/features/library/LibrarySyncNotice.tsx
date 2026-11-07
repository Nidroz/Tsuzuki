import {
  useLibrarySyncIssues,
  type LibrarySyncFeedback,
  type LibrarySyncIssues,
} from '@core/hooks/use-library-sync-issues';
import { useTranslation, type TranslationKey } from '@core/i18n/index';
import { Button, InlineError, Notice, Sheet, SheetActions, Text } from '@ui/index';
import { useCallback, useState } from 'react';

import {
  LIBRARY_SYNC_FEEDBACK_ANNOUNCE_KEY,
  LIBRARY_SYNC_NOTICE_ANNOUNCE_KEY,
} from './announce-keys';

const FEEDBACK_KEYS = {
  offline: 'library.sync.feedback.offline',
  'discard-failed': 'library.sync.feedback.discardFailed',
} as const satisfies Record<LibrarySyncFeedback, TranslationKey>;

export interface LibrarySyncNoticeProps {
  /**
   * the notice gets `testID`, its message `-message`, its buttons `-retry` and `-discard`, the
   * feedback of an action that did not happen `-feedback`, the discard sheet `-discard-sheet` (its
   * buttons `-discard-sheet-cancel` and `-confirm`)
   */
  testID: string;
}

interface StuckWritesNoticeProps extends LibrarySyncNoticeProps {
  readonly issues: LibrarySyncIssues;
}

// mounted while stuck writes are left only: the sheet state goes with the last of them, so a
// later stuck write never reopens a question the user did not answer
function StuckWritesNotice({ issues, testID }: StuckWritesNoticeProps) {
  const { t } = useTranslation();
  const { stuckCount, retrying, feedback, feedbackId, retry, discard } = issues;
  const [confirming, setConfirming] = useState(false);

  const askDiscard = useCallback(() => {
    setConfirming(true);
  }, []);
  const keepChanges = useCallback(() => {
    setConfirming(false);
  }, []);
  const confirmDiscard = useCallback(() => {
    discard();
    setConfirming(false);
  }, [discard]);

  const sheetTestID = `${testID}-discard-sheet`;
  // a fragment: the notice stays the first child of the screen's column, its feedback under it
  return (
    <>
      <Notice
        message={t('library.sync.message', { count: stuckCount })}
        announceKey={LIBRARY_SYNC_NOTICE_ANNOUNCE_KEY}
        testID={testID}
      >
        <Button
          label={t('library.sync.discard')}
          accessibilityLabel={t('library.sync.discardLabel')}
          onPress={askDiscard}
          variant="secondary"
          disabled={retrying}
          testID={`${testID}-discard`}
        />
        <Button
          label={t('library.sync.retry')}
          onPress={retry}
          loading={retrying}
          loadingLabel={t('library.sync.retrying')}
          testID={`${testID}-retry`}
        />
      </Notice>
      {/* keyed by the feedback's identity: a second failed discard in a row, with the same
          message, remounts the alert in every tab in one commit, so it is announced once more */}
      {feedback === null ? null : (
        <InlineError
          key={feedbackId}
          message={t(FEEDBACK_KEYS[feedback])}
          announceKey={LIBRARY_SYNC_FEEDBACK_ANNOUNCE_KEY}
          testID={`${testID}-feedback`}
        />
      )}
      <Sheet
        visible={confirming}
        title={t('library.sync.discardSheet.title')}
        closeLabel={t('library.sync.discardSheet.close')}
        onClose={keepChanges}
        footer={
          <SheetActions
            confirmLabel={t('library.sync.discardSheet.confirm', { count: stuckCount })}
            confirmVariant="danger"
            onConfirm={confirmDiscard}
            cancelLabel={t('library.sync.discardSheet.cancel')}
            onCancel={keepChanges}
            testID={sheetTestID}
          />
        }
        testID={sheetTestID}
      >
        <Text>{t('library.sync.discardSheet.message', { count: stuckCount })}</Text>
      </Sheet>
    </>
  );
}

/**
 * the stuck writes of the account library (ADR-0017 "Stuck writes", useLibrarySyncIssues): while
 * some are left, how many could not be synced, announced, with Try again (pending while it runs,
 * Discard disabled meanwhile, in both tabs) and Discard. Discard asks first in a sheet that says,
 * with the live count, that the version saved in the account, if any, replaces those changes; its
 * confirm is destructive. under the notice, an announced error says what the last action could
 * not do: a Try again while offline, or a Discard whose storage failed. the notice and that error
 * are announced once for both tabs. renders nothing without a stuck write
 */
export function LibrarySyncNotice({ testID }: LibrarySyncNoticeProps) {
  const issues = useLibrarySyncIssues();
  return issues.stuckCount === 0 ? null : <StuckWritesNotice issues={issues} testID={testID} />;
}
