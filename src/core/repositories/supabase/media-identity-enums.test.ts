// the database enums of a media identity match the domain lists, see src/core/domain/media.ts
import { describe, expect, it } from '@jest/globals';

import {
  MEDIA_ID_NAMESPACES,
  MEDIA_KINDS,
  type MediaIdNamespace,
  type MediaKind,
} from '../../domain/media';
import { Constants, type Database } from './database.types';

type Enums = Database['public']['Enums'];

// compile-time checks: fail typecheck as soon as a value is missing on either side
const sameNamespaces: [MediaIdNamespace] extends [Enums['media_id_namespace']]
  ? [Enums['media_id_namespace']] extends [MediaIdNamespace]
    ? true
    : false
  : false = true;
const sameKinds: [MediaKind] extends [Enums['media_kind']]
  ? [Enums['media_kind']] extends [MediaKind]
    ? true
    : false
  : false = true;

describe('media identity enums', () => {
  it('match the domain at the type level', () => {
    expect(sameNamespaces).toBe(true);
    expect(sameKinds).toBe(true);
  });

  it('match the domain at runtime, in order', () => {
    expect(Constants.public.Enums.media_id_namespace).toStrictEqual(MEDIA_ID_NAMESPACES);
    expect(Constants.public.Enums.media_kind).toStrictEqual(MEDIA_KINDS);
  });
});
