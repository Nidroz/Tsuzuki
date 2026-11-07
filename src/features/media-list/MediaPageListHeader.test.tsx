import { CatalogNetworkError, CatalogResponseError } from '@core/errors/catalog-errors';
import { describe, expect, it, jest } from '@jest/globals';
import { screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { MediaPageListHeader } from './MediaPageListHeader';

// per R-03: the note of a list kept after a failed refetch is announced when it shows, by each
// list (the discover and search tabs stay mounted together)

const OFFLINE_NOTE = 'You are offline: this list could not be refreshed.';
const GENERIC_NOTE = 'This list could not be refreshed.';
const FR_OFFLINE_NOTE = "Vous êtes hors ligne : cette liste n'a pas pu être actualisée.";

// the react native jest preset mocks announceForAccessibility: its calls survive restoreMocks
const spyOnAnnounce = () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  announce.mockClear();
  return announce;
};

const noRetry = (): void => undefined;

interface HeaderSpec {
  readonly prefix: string;
  readonly staleError: Error | null;
}

function Headers({ headers }: { readonly headers: readonly HeaderSpec[] }) {
  return (
    <>
      {headers.map(({ prefix, staleError }) => (
        <MediaPageListHeader
          key={prefix}
          updating={false}
          staleError={staleError}
          hiddenCount={0}
          onRetry={noRetry}
          testIDPrefix={prefix}
        />
      ))}
    </>
  );
}

describe('MediaPageListHeader stale note', () => {
  it.each([
    ['offline', new CatalogNetworkError(), OFFLINE_NOTE],
    ['generic', new CatalogResponseError(), GENERIC_NOTE],
  ])('announces the %s note once when it shows', async (_case, error, note) => {
    const announce = spyOnAnnounce();

    await renderWithProviders(<Headers headers={[{ prefix: 'search', staleError: error }]} />);

    expect(screen.getByTestId('search-stale-note')).toHaveTextContent(new RegExp(`^${note}`));
    expect(announce.mock.calls).toStrictEqual([[note]]);
  });

  it('announces it in french', async () => {
    const announce = spyOnAnnounce();

    await renderWithProviders(
      <Headers headers={[{ prefix: 'search', staleError: new CatalogNetworkError() }]} />,
      { language: 'fr' },
    );

    expect(announce.mock.calls).toStrictEqual([[FR_OFFLINE_NOTE]]);
  });

  it('announces nothing without a failed refetch', async () => {
    const announce = spyOnAnnounce();

    await renderWithProviders(<Headers headers={[{ prefix: 'search', staleError: null }]} />);

    expect(screen.queryByTestId('search-stale-note')).not.toBeOnTheScreen();
    expect(announce).not.toHaveBeenCalled();
  });

  it('announces the note of each list, and once more for a list whose retry fails again', async () => {
    const announce = spyOnAnnounce();
    const lists = (searchError: Error | null): HeaderSpec[] => [
      { prefix: 'discover', staleError: new CatalogNetworkError() },
      { prefix: 'search', staleError: searchError },
    ];
    const { rerender } = await renderWithProviders(
      <Headers headers={lists(new CatalogNetworkError())} />,
    );

    // each list's failed refetch is its own event, like its full-screen error
    expect(screen.getByTestId('discover-stale-note')).toBeOnTheScreen();
    expect(screen.getByTestId('search-stale-note')).toBeOnTheScreen();
    expect(announce.mock.calls).toStrictEqual([[OFFLINE_NOTE], [OFFLINE_NOTE]]);

    // the search retry runs: its note goes, the discover one stays
    await rerender(<Headers headers={lists(null)} />);
    expect(screen.queryByTestId('search-stale-note')).not.toBeOnTheScreen();
    expect(screen.getByTestId('discover-stale-note')).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledTimes(2);

    // it failed again: announced once more, though the discover note still shows
    await rerender(<Headers headers={lists(new CatalogNetworkError())} />);
    expect(screen.getByTestId('search-stale-note')).toBeOnTheScreen();
    expect(announce.mock.calls).toStrictEqual([[OFFLINE_NOTE], [OFFLINE_NOTE], [OFFLINE_NOTE]]);
  });
});
