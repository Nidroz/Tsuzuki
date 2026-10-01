import type Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

type IoniconsGlyph = ComponentProps<typeof Ionicons>['name'];

// the icons the app uses, by meaning: screens never name an icon set glyph, so the set can change
// here alone
export const GLYPHS = {
  add: 'add',
  remove: 'remove',
  favorite: 'heart',
  'favorite-outline': 'heart-outline',
  search: 'search',
  close: 'close',
  'chevron-back': 'chevron-back',
  'chevron-forward': 'chevron-forward',
  settings: 'settings-outline',
  refresh: 'refresh',
} as const satisfies Record<string, IoniconsGlyph>;

export type IconName = keyof typeof GLYPHS;

export type TabIconName = 'discover' | 'search' | 'library' | 'favorites' | 'settings';

// one glyph pair per tab: filled for the focused tab, outline for the others
export const TAB_GLYPHS = {
  discover: { focused: 'compass', unfocused: 'compass-outline' },
  search: { focused: 'search', unfocused: 'search-outline' },
  library: { focused: 'library', unfocused: 'library-outline' },
  favorites: { focused: 'heart', unfocused: 'heart-outline' },
  settings: { focused: 'settings', unfocused: 'settings-outline' },
} as const satisfies Record<TabIconName, { focused: IoniconsGlyph; unfocused: IoniconsGlyph }>;
