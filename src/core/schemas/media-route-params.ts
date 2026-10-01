import { z } from 'zod';

import { MAL_ID_MAX, MEDIA_KINDS, type MediaKey } from '../domain/media';

// deep link and route params are untrusted input (CONTRIBUTING.md §7): they are parsed here
// and only ever used to read; a link never triggers a write by itself

// decimal digits only: no sign, leading zero, space, decimal point or exponent
const MAL_ID_PATTERN = /^[1-9][0-9]*$/;

// longer strings cannot fit under MAL_ID_MAX, so they are rejected before any conversion
const MAL_ID_MAX_DIGITS = String(MAL_ID_MAX).length;

const malIdParamSchema = z
  .string()
  .max(MAL_ID_MAX_DIGITS, { abort: true })
  .regex(MAL_ID_PATTERN)
  .transform(Number)
  .pipe(z.number().int().max(MAL_ID_MAX));

/**
 * parses the expo-router params of a media route (`{ kind, id }`) into a media key.
 * A missing or repeated (array) param is rejected; unknown params are stripped.
 */
export const mediaRouteParamsSchema = z
  .object({
    kind: z.enum(MEDIA_KINDS),
    id: malIdParamSchema,
  })
  .transform(({ kind, id }): MediaKey => ({ kind, malId: id }));

/** returns the media key of the route params, or null when they are invalid. */
export const parseMediaRouteParams = (raw: unknown): MediaKey | null => {
  const result = mediaRouteParamsSchema.safeParse(raw);
  return result.success ? result.data : null;
};
