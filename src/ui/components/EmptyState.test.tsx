import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { EmptyState } from './EmptyState';

const TITLE = 'Your library is empty';
const MESSAGE = 'Search for a title to add it';
const ACTION_LABEL = 'Search';
const TEST_ID = 'empty-state';

describe('EmptyState', () => {
  it('shows its title alone by default, centered', async () => {
    await renderWithTheme(<EmptyState title={TITLE} testID={TEST_ID} />);

    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(classesOf(screen.getByText(TITLE))).toEqual(
      expect.arrayContaining(['text-subtitle', 'text-center']),
    );
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
    expect(screen.getByTestId(TEST_ID)).toHaveTextContent(TITLE, { exact: true });
    expect(classesOf(screen.getByTestId(TEST_ID))).toEqual(
      expect.arrayContaining(['items-center', 'justify-center', 'flex-1']),
    );
  });

  it('shows its message in the muted tone', async () => {
    await renderWithTheme(<EmptyState title={TITLE} message={MESSAGE} />);

    expect(classesOf(screen.getByText(MESSAGE))).toEqual(
      expect.arrayContaining(['text-text-muted', 'text-center']),
    );
  });

  it('shows its action as a button that calls onPress', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(<EmptyState title={TITLE} action={{ label: ACTION_LABEL, onPress }} />);

    await user.press(screen.getByRole('button', { name: ACTION_LABEL }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders without a testID', async () => {
    await renderWithTheme(<EmptyState title={TITLE} />);

    expect(screen.getByText(TITLE)).toBeOnTheScreen();
  });
});
