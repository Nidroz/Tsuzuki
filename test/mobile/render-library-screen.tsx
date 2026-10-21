// renders the library screen over an in-memory library repository, for the LibraryScreen tests.
// the tests mock expo-router's router themselves
import type { Language } from '@core/i18n/index';
import { LibraryContextProvider } from '@core/hooks/LibraryContextProvider';
import { createQueryClient } from '@core/query/query-client';
import { jest } from '@jest/globals';
import type { QueryClient } from '@tanstack/react-query';
import { act, screen, userEvent } from '@testing-library/react-native';

import { LibraryScreen } from '@features/library/LibraryScreen';
import { LIBRARY } from '@features/library/__fixtures__/library-entries';
import {
  createFakeLibraryRepository,
  type FakeLibraryRepository,
} from '../core/fake-library-repository';
import { renderWithProviders } from './render-with-providers';

export interface LibraryScreenSetup {
  /** the repository of the screen; a fake holding LIBRARY by default */
  readonly repository?: FakeLibraryRepository;
  readonly language?: Language;
  /** the query cache of the screen; a new one by default */
  readonly queryClient?: QueryClient;
}

/** renders LibraryScreen over a fake library repository and returns it with a user */
export const renderLibraryScreen = async ({
  repository = createFakeLibraryRepository(LIBRARY),
  language = 'en',
  queryClient = createQueryClient(),
}: LibraryScreenSetup = {}) => {
  await renderWithProviders(
    <LibraryContextProvider repository={repository}>
      <LibraryScreen />
    </LibraryContextProvider>,
    { language, queryClient },
  );
  return { repository, user: userEvent.setup() };
};

/** lets the pending repository calls settle, after `ms` of fake time */
export const settle = async (ms = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

// the item index of the list cell holding `element`: flashlist renders its cells in recycling
// order, so the tree order says nothing of the list order once the items change
const cellIndexOf = (element: ReturnType<typeof screen.getByText>): number => {
  for (let node = element.parent; node !== null; node = node.parent) {
    const index: unknown = node.props.index;
    if (typeof index === 'number') {
      return index;
    }
  }
  throw new Error('the element is not in a list cell');
};

/** the texts matching `pattern` (section headers, row titles), in the order of the list items */
export const textsInListOrder = (pattern: RegExp): readonly string[] =>
  screen
    .getAllByText(pattern)
    .map((element) => ({ index: cellIndexOf(element), text: String(element.props.children) }))
    .sort((a, b) => a.index - b.index)
    .map(({ text }) => text);
