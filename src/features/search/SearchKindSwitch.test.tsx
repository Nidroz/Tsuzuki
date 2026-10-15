import type { MediaKind } from '@core/domain/media';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { SearchKindSwitch } from './SearchKindSwitch';

const renderSwitch = (kind: MediaKind, onChange = jest.fn<(kind: MediaKind) => void>()) =>
  renderWithProviders(<SearchKindSwitch kind={kind} onChange={onChange} />);

describe('SearchKindSwitch', () => {
  it('shows one button per kind, anime then manga, the given kind alone selected', async () => {
    await renderSwitch('anime');

    const buttons = screen.getAllByRole('button');
    expect(buttons).toStrictEqual([
      screen.getByRole('button', { name: 'Anime' }),
      screen.getByRole('button', { name: 'Manga' }),
    ]);
    expect(screen.getByTestId('search-kind-anime')).toBeSelected();
    expect(screen.getByTestId('search-kind-manga')).not.toBeSelected();
  });

  it('selects manga when it is the kind', async () => {
    await renderSwitch('manga');

    expect(screen.getByRole('button', { name: 'Manga' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Anime' })).not.toBeSelected();
  });

  it.each<[string, MediaKind, MediaKind]>([
    ['manga', 'anime', 'manga'],
    ['anime', 'manga', 'anime'],
  ])('asks for %s when its button is pressed', async (name, current, pressed) => {
    const user = userEvent.setup();
    const onChange = jest.fn<(kind: MediaKind) => void>();
    await renderSwitch(current, onChange);

    await user.press(screen.getByRole('button', { name: new RegExp(`^${name}$`, 'i') }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(pressed);
  });

  it('labels the kinds in french', async () => {
    await renderWithProviders(<SearchKindSwitch kind="anime" onChange={jest.fn()} />, {
      language: 'fr',
    });

    expect(screen.getByRole('button', { name: 'Anime' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Manga' })).toBeOnTheScreen();
  });
});
