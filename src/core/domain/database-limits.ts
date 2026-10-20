// storage bounds of the database columns the domain validates against, docs/ARCHITECTURE.md §5

/**
 * the largest value of a postgres `integer` column (2^31 - 1): the bound of
 * library_entries.external_id, media_total_units and progress.
 */
export const POSTGRES_INTEGER_MAX = 2_147_483_647;

/** the longest media title, in code points (library_entries_media_title_check). */
export const MEDIA_TITLE_MAX_LENGTH = 500;

/** the longest media image url, in code points (library_entries_media_image_url_check). */
export const MEDIA_IMAGE_URL_MAX_LENGTH = 2048;

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;
const SURROGATE_PAIR_LENGTH = 2;

const isHighSurrogate = (unit: number): boolean =>
  unit >= HIGH_SURROGATE_MIN && unit <= HIGH_SURROGATE_MAX;

const isLowSurrogate = (unit: number): boolean =>
  unit >= LOW_SURROGATE_MIN && unit <= LOW_SURROGATE_MAX;

// the utf-16 length of the code point starting at `index`: 2 for a surrogate pair, else 1 (a lone
// surrogate is one code point)
const codePointWidthAt = (text: string, index: number): number =>
  isHighSurrogate(text.charCodeAt(index)) && isLowSurrogate(text.charCodeAt(index + 1))
    ? SURROGATE_PAIR_LENGTH
    : 1;

/**
 * the length of `text` in code points, as postgres `char_length` counts it: a surrogate pair is
 * one, a lone surrogate is one too. a manual scan, so it does not depend on the string iterator.
 */
export const codePointLength = (text: string): number => {
  let count = 0;
  let index = 0;
  while (index < text.length) {
    index += codePointWidthAt(text, index);
    count += 1;
  }
  return count;
};

/**
 * the first `maxLength` code points of `text` (counted as codePointLength counts them), never
 * splitting a surrogate pair; `text` itself when it is not longer. `maxLength` is a non-negative
 * integer chosen by the caller.
 */
export const truncateToCodePoints = (text: string, maxLength: number): string => {
  let count = 0;
  let index = 0;
  while (index < text.length && count < maxLength) {
    index += codePointWidthAt(text, index);
    count += 1;
  }
  return index >= text.length ? text : text.slice(0, index);
};

// postgres text rejects U+0000
const NUL = 0x0000;
const REPLACEMENT_CHARACTER = '\uFFFD';

/**
 * whether postgres can store `text` in a text column: false when it holds U+0000 (NUL, rejected
 * by postgres text) or a lone surrogate (an unpaired high or low surrogate code unit, which has
 * no UTF-8 encoding). a manual scan, so it does not depend on String#isWellFormed.
 */
export const isStorableText = (text: string): boolean => {
  let index = 0;
  while (index < text.length) {
    const unit = text.charCodeAt(index);
    const width = codePointWidthAt(text, index);
    if (unit === NUL || (width === 1 && (isHighSurrogate(unit) || isLowSurrogate(unit)))) {
      return false;
    }
    index += width;
  }
  return true;
};

/**
 * `text` made storable (see isStorableText): NUL characters removed and each lone surrogate
 * replaced with U+FFFD; surrogate pairs are kept. pairing is decided on `text` itself, so removing
 * a NUL never joins two lone surrogates into a pair. `text` itself when it is already storable.
 */
export const toStorableText = (text: string): string => {
  if (isStorableText(text)) {
    return text;
  }
  let result = '';
  let index = 0;
  while (index < text.length) {
    const unit = text.charCodeAt(index);
    const width = codePointWidthAt(text, index);
    if (width === SURROGATE_PAIR_LENGTH) {
      result += text.slice(index, index + width);
    } else if (isHighSurrogate(unit) || isLowSurrogate(unit)) {
      result += REPLACEMENT_CHARACTER;
    } else if (unit !== NUL) {
      result += text.charAt(index);
    }
    index += width;
  }
  return result;
};
