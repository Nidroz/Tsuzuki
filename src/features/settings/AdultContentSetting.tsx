import { useTranslation } from '@core/i18n/index';
import { usePreferences } from '@core/preferences/index';
import { Box, Row, Sheet, SheetActions, Stack, Switch, Text } from '@ui/index';
import { useState } from 'react';

const TEST_ID = 'settings-adult-content';
const SWITCH_TEST_ID = `${TEST_ID}-switch`;
const CONFIRM_TEST_ID = `${TEST_ID}-confirm`;

/**
 * the adult content setting (FR-32, BR-06), off by default. turning it on asks for a confirmation
 * first (no age verification: the user turns it on at their own risk); the switch stays off until
 * the user confirms. turning it off applies at once
 */
export function AdultContentSetting() {
  const { t } = useTranslation();
  const { showAdult, setShowAdult } = usePreferences();
  const [confirming, setConfirming] = useState(false);
  const label = t('settings.adultContent.label');

  const change = (next: boolean) => {
    if (next) {
      setConfirming(true);
    } else {
      setShowAdult(false);
    }
  };

  const close = () => {
    setConfirming(false);
  };

  const confirm = () => {
    setShowAdult(true);
    setConfirming(false);
  };

  return (
    <Stack gap="sm" testID={TEST_ID}>
      <Text variant="subtitle">{t('settings.adultContent.title')}</Text>
      <Row gap="md" justify="between">
        <Box flex>
          <Text>{label}</Text>
        </Box>
        <Switch
          value={showAdult}
          onValueChange={change}
          accessibilityLabel={label}
          testID={SWITCH_TEST_ID}
        />
      </Row>
      <Text variant="caption" tone="muted">
        {t('settings.adultContent.description')}
      </Text>
      <Sheet
        visible={confirming}
        title={t('settings.adultContent.confirm.title')}
        closeLabel={t('settings.adultContent.confirm.close')}
        onClose={close}
        footer={
          <SheetActions
            confirmLabel={t('settings.adultContent.confirm.confirm')}
            onConfirm={confirm}
            cancelLabel={t('settings.adultContent.confirm.cancel')}
            onCancel={close}
            testID={CONFIRM_TEST_ID}
          />
        }
        testID={CONFIRM_TEST_ID}
      >
        <Text>{t('settings.adultContent.confirm.message')}</Text>
      </Sheet>
    </Stack>
  );
}
