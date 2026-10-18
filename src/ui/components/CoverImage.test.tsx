import Ionicons from '@expo/vector-icons/Ionicons';
import { describe, expect, it } from '@jest/globals';
import { isHiddenFromAccessibility, screen } from '@testing-library/react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { palettes } from '../theme/colors';
import { CoverImage } from './CoverImage';

const TEST_ID = 'cover';
const IMAGE_TEST_ID = `${TEST_ID}-image`;
const PLACEHOLDER_TEST_ID = `${TEST_ID}-placeholder`;
// a cover url as the catalog adapter keeps it, with a query string that must survive untouched
const URL = 'https://cdn.myanimelist.net/images/anime/1015/138006.jpg?s=4b8a8fc2';
const OTHER_URL = 'https://cdn.myanimelist.net/images/manga/2/253146.jpg';
const FRAME_CLASSES = [
  'items-center',
  'justify-center',
  'overflow-hidden',
  'rounded-sm',
  'bg-surface-muted',
];
const PLACEHOLDER_CHAR = String.fromCodePoint(Number(Ionicons.glyphMap['image-outline']));

const frame = () => screen.getByTestId(TEST_ID, { includeHiddenElements: true });
const image = () => screen.getByTestId(IMAGE_TEST_ID, { includeHiddenElements: true });
const queryImage = () => screen.queryByTestId(IMAGE_TEST_ID, { includeHiddenElements: true });
const placeholder = () => screen.getByTestId(PLACEHOLDER_TEST_ID, { includeHiddenElements: true });

describe('CoverImage', () => {
  it('loads exactly the given url, with no other source', async () => {
    await renderWithTheme(<CoverImage url={URL} testID={TEST_ID} />);

    expect(image().props.source).toStrictEqual([{ uri: URL }]);
    expect(image().props.placeholder).toStrictEqual([]);
  });

  it('caches in memory and on disk, fills the frame and recycles by url', async () => {
    await renderWithTheme(<CoverImage url={URL} testID={TEST_ID} />);

    expect(image()).toHaveProp('cachePolicy', 'memory-disk');
    expect(image()).toHaveProp('contentFit', 'cover');
    expect(image()).toHaveProp('recyclingKey', URL);
  });

  it('follows a new url with its recycling key', async () => {
    const { rerender } = await renderWithTheme(<CoverImage url={URL} testID={TEST_ID} />);

    await rerender(<CoverImage url={OTHER_URL} testID={TEST_ID} />);

    expect(image().props.source).toStrictEqual([{ uri: OTHER_URL }]);
    expect(image()).toHaveProp('recyclingKey', OTHER_URL);
  });

  it('renders a placeholder glyph and no image without a url', async () => {
    await renderWithTheme(<CoverImage url={null} testID={TEST_ID} />);

    expect(queryImage()).not.toBeOnTheScreen();
    expect(placeholder()).toHaveTextContent(PLACEHOLDER_CHAR);
    expect(frame()).toContainElement(placeholder());
  });

  it('draws the placeholder glyph in the muted text color', async () => {
    await renderWithTheme(<CoverImage url={null} testID={TEST_ID} />);

    const style = Object.assign({}, ...[placeholder().props.style as unknown].flat(Infinity)) as {
      color?: unknown;
    };

    expect(style.color).toBe(palettes.light.textMuted);
  });

  it('draws a medium 2:3 frame by default and a small or large one on request', async () => {
    const { rerender } = await renderWithTheme(<CoverImage url={URL} testID={TEST_ID} />);

    expect(classesOf(frame())).toStrictEqual(['h-cover-md', 'w-cover-md', ...FRAME_CLASSES]);

    await rerender(<CoverImage url={URL} size="sm" testID={TEST_ID} />);

    expect(classesOf(frame())).toStrictEqual(['h-cover-sm', 'w-cover-sm', ...FRAME_CLASSES]);

    await rerender(<CoverImage url={URL} size="lg" testID={TEST_ID} />);

    expect(classesOf(frame())).toStrictEqual(['h-cover-lg', 'w-cover-lg', ...FRAME_CLASSES]);
  });

  it('draws the large frame as a placeholder too', async () => {
    await renderWithTheme(<CoverImage url={null} size="lg" testID={TEST_ID} />);

    expect(classesOf(frame())).toStrictEqual(['h-cover-lg', 'w-cover-lg', ...FRAME_CLASSES]);
    expect(frame()).toContainElement(placeholder());
  });

  it.each([
    ['with an image', URL],
    ['as a placeholder', null],
  ])('is hidden from screen readers on both platforms %s', async (_case, url) => {
    await renderWithTheme(<CoverImage url={url} testID={TEST_ID} />);

    expect(frame()).toHaveProp('accessibilityElementsHidden', true);
    expect(frame()).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    expect(isHiddenFromAccessibility(frame())).toBe(true);
    expect(screen.queryByTestId(TEST_ID)).not.toBeOnTheScreen();
  });

  it('renders its placeholder without a testID', async () => {
    await renderWithTheme(<CoverImage url={null} />);

    expect(screen.getByText(PLACEHOLDER_CHAR, { includeHiddenElements: true })).toBeTruthy();
  });
});
