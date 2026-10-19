import type { MediaKind } from '@core/domain/media';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { SearchKindSwitch } from './SearchKindSwitch';

const renderSwitch = (kind: MediaKind, onChange = jest.fn<(kind: MediaKind) => void>()) =>
  renderWithProviders(<SearchKindSwitch kind={kind} onChange={onChange} />);

describe('SearchKindSwitch', () => {
  it('is a radio group of one radio per kind, anime then manga, the kind checked', async () => {
    await renderSwitch('anime');

    // the group is not an accessible element itself: role queries miss it (RadioGroup.test.tsx)
    const group = screen.getByTestId('search-kind');
    expect(group).toHaveProp('accessibilityRole', 'radiogroup');
    expect(group).toHaveProp('accessibilityLabel', 'Kind');
    expect(screen.getAllByRole('radio')).toStrictEqual([
      screen.getByRole('radio', { name: 'Anime' }),
      screen.getByRole('radio', { name: 'Manga' }),
    ]);
    expect(screen.getByTestId('search-kind-anime')).toBeChecked();
    expect(screen.getByTestId('search-kind-manga')).not.toBeChecked();
  });

  it('checks manga when it is the kind', async () => {
    await renderSwitch('manga');

    expect(screen.getByRole('radio', { name: 'Manga' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Anime' })).not.toBeChecked();
  });

  it.each<[string, MediaKind, MediaKind]>([
    ['manga', 'anime', 'manga'],
    ['anime', 'manga', 'anime'],
  ])('asks for %s when its radio is pressed', async (name, current, pressed) => {
    const user = userEvent.setup();
    const onChange = jest.fn<(kind: MediaKind) => void>();
    await renderSwitch(current, onChange);

    await user.press(screen.getByRole('radio', { name: new RegExp(`^${name}$`, 'i') }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(pressed);
  });

  it('labels the kinds in french', async () => {
    await renderWithProviders(<SearchKindSwitch kind="anime" onChange={jest.fn()} />, {
      language: 'fr',
    });

    expect(screen.getByTestId('search-kind')).toHaveProp('accessibilityLabel', 'Type');
    expect(screen.getByRole('radio', { name: 'Anime' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Manga' })).toBeOnTheScreen();
  });
});
