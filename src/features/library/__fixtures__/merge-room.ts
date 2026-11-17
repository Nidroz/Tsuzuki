// the account library of the LibraryScreen tests while the guest merge is refused at the cap
// (R-09), with the texts they check; test/mobile/render-library-screen.tsx renders it
import type { GuestMergeValue } from '@core/hooks/guest-merge-context';
import { jest } from '@jest/globals';

import { BERSERK, FRIEREN } from './library-entries';

/** the account entries of the room: an anime, then a manga (the repository order) */
export const ROOM_ENTRIES = [FRIEREN, BERSERK] as const;

/** the notice of the room, in english */
export const ROOM_NOTICE =
  "Your account's library is full, with 10,000 titles, so the titles saved on this device could not be added to it. They stay on this device. Remove titles from your account here to make room: after each removal, they are added if there is room.";

/** the accessibility label of the Remove of a row */
export const removeLabelOf = (title: string): string => `Remove ${title} from your account`;

/** a merge refused at the cap, its retry a mock; a new value per call, as the provider gives */
export const fullMergeOf = (retry = jest.fn<() => void>()): GuestMergeValue => ({
  status: 'failed',
  failure: 'library-full',
  retry,
});
