import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent, within } from '@testing-library/react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { MediaListItem } from './MediaListItem';

const TITLE = 'Sousou no Frieren';
const SUBTITLE = "Frieren: Beyond Journey's End";
const DETAILS = ['TV', '2023', 'Score 9.3'] as const;
const URL = 'https://cdn.myanimelist.net/images/anime/1015/138006.jpg';
const TEST_ID = 'row';
const COVER_TEST_ID = `${TEST_ID}-cover`;
const HINT = 'Opens the details';
const LABEL = 'Frieren, anime';

const row = () => screen.getByTestId(TEST_ID);
const cover = () => screen.getByTestId(COVER_TEST_ID, { includeHiddenElements: true });

describe('MediaListItem', () => {
  it('shows the title, the subtitle and every detail', async () => {
    await renderWithTheme(
      <MediaListItem
        title={TITLE}
        subtitle={SUBTITLE}
        details={DETAILS}
        imageUrl={URL}
        onPress={jest.fn()}
        testID={TEST_ID}
      />,
    );

    const inRow = within(row());

    expect(inRow.getByText(TITLE)).toHaveProp('numberOfLines', 2);
    expect(inRow.getByText(SUBTITLE)).toHaveProp('numberOfLines', 1);
    for (const detail of DETAILS) {
      expect(classesOf(inRow.getByText(detail))).toEqual(
        expect.arrayContaining(['text-caption', 'text-text-muted']),
      );
    }
  });

  it('is a button named by its lines joined with commas', async () => {
    await renderWithTheme(
      <MediaListItem
        title={TITLE}
        subtitle={SUBTITLE}
        details={DETAILS}
        imageUrl={URL}
        onPress={jest.fn()}
        testID={TEST_ID}
      />,
    );

    expect(screen.getByRole('button', { name: [TITLE, SUBTITLE, ...DETAILS].join(', ') })).toBe(
      row(),
    );
  });

  it('is named by its title alone without subtitle and details', async () => {
    await renderWithTheme(
      <MediaListItem title={TITLE} imageUrl={null} onPress={jest.fn()} testID={TEST_ID} />,
    );

    expect(row()).toHaveAccessibleName(TITLE);
    expect(screen.queryByText(SUBTITLE)).not.toBeOnTheScreen();
  });

  it('takes an explicit accessibility label and hint', async () => {
    await renderWithTheme(
      <MediaListItem
        title={TITLE}
        imageUrl={null}
        onPress={jest.fn()}
        accessibilityLabel={LABEL}
        accessibilityHint={HINT}
        testID={TEST_ID}
      />,
    );

    expect(screen.getByRole('button', { name: LABEL })).toBe(row());
    expect(screen.getByHintText(HINT)).toBe(row());
  });

  it('calls onPress when pressed', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    await renderWithTheme(
      <MediaListItem title={TITLE} imageUrl={URL} onPress={onPress} testID={TEST_ID} />,
    );

    await user.press(row());

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows the cover of the given url, hidden from screen readers', async () => {
    await renderWithTheme(
      <MediaListItem title={TITLE} imageUrl={URL} onPress={jest.fn()} testID={TEST_ID} />,
    );

    const image = screen.getByTestId(`${COVER_TEST_ID}-image`, { includeHiddenElements: true });

    expect(row()).toContainElement(cover());
    expect(image.props.source).toStrictEqual([{ uri: URL }]);
    expect(cover()).toHaveProp('accessibilityElementsHidden', true);
  });

  it('shows the cover placeholder without a url', async () => {
    await renderWithTheme(
      <MediaListItem title={TITLE} imageUrl={null} onPress={jest.fn()} testID={TEST_ID} />,
    );

    expect(
      screen.getByTestId(`${COVER_TEST_ID}-placeholder`, { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(
      screen.queryByTestId(`${COVER_TEST_ID}-image`, { includeHiddenElements: true }),
    ).not.toBeOnTheScreen();
  });

  it('draws a full-size touch target that dims while pressed', async () => {
    await renderWithTheme(
      <MediaListItem title={TITLE} imageUrl={null} onPress={jest.fn()} testID={TEST_ID} />,
    );

    expect(classesOf(row())).toEqual(
      expect.arrayContaining(['min-h-touch', 'flex-row', 'gap-md', 'active:opacity-pressed']),
    );
  });
});
