import { describe, expect, it } from '@jest/globals';
import { screen } from '@testing-library/react-native';

import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { palettes } from '../theme/colors';
import { Spinner } from './Spinner';

const LABEL = 'Loading results';
const TEST_ID = 'spinner';

describe('Spinner', () => {
  it('is announced as a busy progress bar with its label', async () => {
    await renderWithTheme(<Spinner accessibilityLabel={LABEL} testID={TEST_ID} />);

    const spinner = screen.getByRole('progressbar', { name: LABEL });

    expect(spinner).toBe(screen.getByTestId(TEST_ID));
    expect(spinner).toBeBusy();
  });

  it('is large and drawn in the primary color by default', async () => {
    await renderWithTheme(<Spinner accessibilityLabel={LABEL} testID={TEST_ID} />);

    expect(screen.getByTestId(TEST_ID)).toHaveProp('size', 'large');
    expect(screen.getByTestId(TEST_ID)).toHaveProp('color', palettes.light.primary);
  });

  it('can be small', async () => {
    await renderWithTheme(<Spinner accessibilityLabel={LABEL} size="small" testID={TEST_ID} />);

    expect(screen.getByTestId(TEST_ID)).toHaveProp('size', 'small');
  });

  it('requires an accessibility label', async () => {
    // @ts-expect-error(type-test): screen readers need a translated description of what is loading
    await renderWithTheme(<Spinner testID={TEST_ID} />);

    expect(screen.getByTestId(TEST_ID)).toBeOnTheScreen();
  });
});
