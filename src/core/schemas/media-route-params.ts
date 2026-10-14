import { z } from 'zod';

import { EXTERNAL_ID_MAX, MEDIA_ID_NAMESPACES, MEDIA_KINDS, type MediaKey } from '../domain/media';

// deep link and route params are untrusted input (CONTRIBUTING.md §7): they are parsed here
// and only ever used to read; a link never triggers a write by itself

// decimal digits only: no sign, leading zero, space, decimal point or exponent
const EXTERNAL_ID_PATTERN = /^[1-9][0-9]*$/;

// longer strings cannot fit under EXTERNAL_ID_MAX, so they are rejected before any conversion
const EXTERNAL_ID_MAX_DIGITS = String(EXTERNAL_ID_MAX).length;

const externalIdParamSchema = z
  .string()
  .max(EXTERNAL_ID_MAX_DIGITS, { abort: true })
  .regex(EXTERNAL_ID_PATTERN)
  .transform(Number)
  .pipe(z.number().int().max(EXTERNAL_ID_MAX));

/**
 * parses the expo-router params of a media route (`{ namespace, kind, id }`) into a media key.
 * A missing or repeated (array) param is rejected; unknown params are stripped.
 */
export const mediaRouteParamsSchema = z
  .object({
    namespace: z.enum(MEDIA_ID_NAMESPACES),
    kind: z.enum(MEDIA_KINDS),
    id: externalIdParamSchema,
  })
  .transform(({ namespace, kind, id }): MediaKey => ({ namespace, kind, externalId: id }));

/** returns the media key of the route params, or null when they are invalid. */
export const parseMediaRouteParams = (raw: unknown): MediaKey | null => {
  const result = mediaRouteParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
};
