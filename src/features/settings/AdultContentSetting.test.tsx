import type { LanguagePreference } from '@core/i18n/index';
import { PreferencesProvider, type ThemePreference } from '@core/preferences/index';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, userEvent } from '@testing-library/react-native';
import { useState } from 'react';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { AdultContentSetting } from './AdultContentSetting';

const TEST_ID = 'settings-adult-content';
const SWITCH_TEST_ID = `${TEST_ID}-switch`;
const CONFIRM_TEST_ID = `${TEST_ID}-confirm`;
const CONFIRM_BUTTON_TEST_ID = `${CONFIRM_TEST_ID}-confirm`;

const TITLE = 'Adult content';
const LABEL = 'Show adult content';
const DESCRIPTION =
  'While this is off, adult titles are hidden in search, Discover, details and the library.';
const CONFIRM_TITLE = 'Show adult content?';
const CONFIRM_MESSAGE =
  'Adult titles may be unsuitable for minors. By turning this on, you confirm that you want to see them, at your own risk.';
const FRENCH_TITLE = 'Contenu adulte';
const FRENCH_LABEL = 'Afficher le contenu adulte';

type ShowAdultHandler = (showAdult: boolean) => void;

interface HarnessProps {
  readonly initial: boolean;
  readonly onShowAdultChange: ShowAdultHandler;
}

// owns the setting like the composition root does: a change is recorded, then applied
function Harness({ initial, onShowAdultChange }: HarnessProps) {
  const [showAdult, setShowAdult] = useState(initial);
  const change = (next: boolean) => {
    onShowAdultChange(next);
    setShowAdult(next);
  };
  return (
    <PreferencesProvider
      theme="system"
      language="system"
      onThemeChange={jest.fn<(theme: ThemePreference) => void>()}
      onLanguageChange={jest.fn<(language: LanguagePreference) => void>()}
      showAdult={showAdult}
      onShowAdultChange={change}
    >
      <AdultContentSetting />
    </PreferencesProvider>
  );
}

const renderSetting = async (initial = false, language: 'en' | 'fr' = 'en') => {
  const onShowAdultChange = jest.fn<ShowAdultHandler>();
  await renderWithProviders(<Harness initial={initial} onShowAdultChange={onShowAdultChange} />, {
    language,
  });
  return { onShowAdultChange, user: userEvent.setup() };
};

const adultSwitch = () => screen.getByTestId(SWITCH_TEST_ID);

// the switch is a native control: flipping it sends its new value
const flip = async (value: boolean) => {
  await fireEvent(adultSwitch(), 'valueChange', value);
};

describe('AdultContentSetting', () => {
  it('shows its title, description and a switch named by its label, off by default', async () => {
    await renderSetting();

    expect(screen.getByTestId(TEST_ID)).toBeOnTheScreen();
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(screen.getByText(DESCRIPTION)).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: LABEL })).toBe(adultSwitch());
    expect(adultSwitch()).not.toBeChecked();
    expect(screen.queryByTestId(CONFIRM_BUTTON_TEST_ID)).not.toBeOnTheScreen();
  });

  it('is translated', async () => {
    await renderSetting(false, 'fr');

    expect(screen.getByText(FRENCH_TITLE)).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: FRENCH_LABEL })).toBeOnTheScreen();
  });

  it('asks for a confirmation when turned on, without turning it on yet', async () => {
    const { onShowAdultChange } = await renderSetting();

    await flip(true);

    expect(screen.getByRole('header', { name: CONFIRM_TITLE })).toBeOnTheScreen();
    expect(screen.getByText(CONFIRM_MESSAGE)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProp(
      'testID',
      `${CONFIRM_TEST_ID}-cancel`,
    );
    expect(screen.getByRole('button', { name: 'Turn on' })).toHaveProp(
      'testID',
      CONFIRM_BUTTON_TEST_ID,
    );
    expect(onShowAdultChange).not.toHaveBeenCalled();
    expect(adultSwitch()).not.toBeChecked();
  });

  it.each([
    ['Cancel', `${CONFIRM_TEST_ID}-cancel`],
    ['the close button', `${CONFIRM_TEST_ID}-close`],
  ])('stays off when the confirmation is dismissed with %s', async (_case, testID) => {
    const { onShowAdultChange, user } = await renderSetting();
    await flip(true);

    await user.press(screen.getByTestId(testID));

    expect(screen.queryByTestId(CONFIRM_BUTTON_TEST_ID)).not.toBeOnTheScreen();
    expect(onShowAdultChange).not.toHaveBeenCalled();
    expect(adultSwitch()).not.toBeChecked();
  });

  it('turns on when the confirmation is accepted, then closes it', async () => {
    const { onShowAdultChange, user } = await renderSetting();
    await flip(true);

    await user.press(screen.getByRole('button', { name: 'Turn on' }));

    expect(onShowAdultChange).toHaveBeenCalledTimes(1);
    expect(onShowAdultChange).toHaveBeenCalledWith(true);
    expect(adultSwitch()).toBeChecked();
    expect(screen.queryByTestId(CONFIRM_BUTTON_TEST_ID)).not.toBeOnTheScreen();
  });

  it('turns off at once, without a confirmation', async () => {
    const { onShowAdultChange } = await renderSetting(true);
    expect(adultSwitch()).toBeChecked();

    await flip(false);

    expect(onShowAdultChange).toHaveBeenCalledTimes(1);
    expect(onShowAdultChange).toHaveBeenCalledWith(false);
    expect(adultSwitch()).not.toBeChecked();
    expect(screen.queryByTestId(CONFIRM_BUTTON_TEST_ID)).not.toBeOnTheScreen();
  });
});
