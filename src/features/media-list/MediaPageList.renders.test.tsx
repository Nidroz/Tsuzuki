import type { MediaSummary } from '@core/catalog/catalog-provider';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type * as Ui from '@ui/index';
import type * as React from 'react';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import {
  FRIEREN,
  FRIEREN_GOLDEN_LAND,
  filteredPageOf,
} from '../search/__fixtures__/search-results';
import { MediaPageList, type MediaPageListProps } from './MediaPageList';

// a list re-rendered with the same page and onOpen keeps its rows' render (R-02): e.g. the
// search screen, which re-renders on every keystroke

// the testID of each MediaListItem rendered, in render order
const mockRendered: string[] = [];

// the real ui, with each MediaListItem render counted by its testID
jest.mock('@ui/index', () => {
  const actual = jest.requireActual<typeof Ui>('@ui/index');
  const { createElement } = jest.requireActual<typeof React>('react');
  return {
    ...actual,
    MediaListItem: (props: Ui.MediaListItemProps) => {
      mockRendered.push(props.testID ?? '');
      return createElement(actual.MediaListItem, props);
    },
  };
});

const FRIEREN_ROW = 'search-result-mal-anime-52991';
const GOLDEN_LAND_ROW = 'search-result-mal-anime-63816';
const PAGE = filteredPageOf(0, FRIEREN, FRIEREN_GOLDEN_LAND);
const onRetry = jest.fn<() => void>();
const onPageChange = jest.fn<(page: number) => void>();

const propsOf = (
  onOpen: (item: MediaSummary) => void,
  isFetching: boolean,
): MediaPageListProps => ({
  page: PAGE,
  error: null,
  isFetching,
  isPlaceholderData: false,
  isPlaceholderFromOtherList: false,
  onRetry,
  onOpen,
  currentPage: 1,
  onPageChange,
  scrollToTopKey: 'frieren#1',
  testIDPrefix: 'search',
  emptyTitle: 'No results',
  emptyMessage: 'Try another title, or the other kind.',
});

const rendersOf = (testID: string): number => mockRendered.filter((id) => id === testID).length;

describe('MediaPageList row renders', () => {
  beforeEach(() => {
    mockRendered.length = 0;
  });

  it('keeps the rows when re-rendered with the same page and onOpen', async () => {
    const onOpen = jest.fn<(item: MediaSummary) => void>();
    const { rerender } = await renderWithProviders(<MediaPageList {...propsOf(onOpen, false)} />);
    expect(rendersOf(FRIEREN_ROW)).toBe(1);
    expect(rendersOf(GOLDEN_LAND_ROW)).toBe(1);
    mockRendered.length = 0;

    await rerender(<MediaPageList {...propsOf(onOpen, true)} />);

    expect(mockRendered).toStrictEqual([]);
  });

  it('re-renders the rows for a new onOpen, so the count sees a render', async () => {
    const { rerender } = await renderWithProviders(
      <MediaPageList {...propsOf(jest.fn<(item: MediaSummary) => void>(), false)} />,
    );
    mockRendered.length = 0;

    await rerender(<MediaPageList {...propsOf(jest.fn<(item: MediaSummary) => void>(), false)} />);

    expect(rendersOf(FRIEREN_ROW)).toBe(1);
    expect(rendersOf(GOLDEN_LAND_ROW)).toBe(1);
  });
});
