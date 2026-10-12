// the owner rule: a publication status name is never a library status name, see src/core/domain/media.ts
import { describe, expect, it } from '@jest/globals';

import { MEDIA_STATUSES, type MediaStatus } from '../../domain/media';
import { Constants, type Database } from './database.types';

type LibraryStatus = Database['public']['Enums']['library_status'];

// compile-time check: fails typecheck as soon as one name is shared
const noOverlap: [Extract<MediaStatus, LibraryStatus>] extends [never] ? true : false = true;

describe('publication and library status names', () => {
  it('share no name at the type level', () => {
    expect(noOverlap).toBe(true);
  });

  it('share no name at runtime', () => {
    const libraryStatuses: readonly string[] = Constants.public.Enums.library_status;
    expect(MEDIA_STATUSES.filter((status) => libraryStatuses.includes(status))).toStrictEqual([]);
  });
});
