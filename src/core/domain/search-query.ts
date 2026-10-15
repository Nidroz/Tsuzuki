// the search text sent to a catalog provider for a search field value (FR-01, docs/ARCHITECTURE.md
// §6): well-formed, trimmed and within the provider limit, so a prepared query is always accepted

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;
const SURROGATE_PAIR_LENGTH = 2;

const isHighSurrogate = (unit: number): boolean =>
  unit >= HIGH_SURROGATE_MIN && unit <= HIGH_SURROGATE_MAX;

const isLowSurrogate = (unit: number): boolean =>
  unit >= LOW_SURROGATE_MIN && unit <= LOW_SURROGATE_MAX;

// a manual scan of the utf-16 code units: hermes may lack String.prototype.toWellFormed. a high
// surrogate is kept with the low one that follows it; any other surrogate is lone and removed
const withoutLoneSurrogates = (text: string): string => {
  let result = '';
  let index = 0;
  while (index < text.length) {
    const unit = text.charCodeAt(index);
    if (isHighSurrogate(unit) && isLowSurrogate(text.charCodeAt(index + 1))) {
      result += text.slice(index, index + SURROGATE_PAIR_LENGTH);
      index += SURROGATE_PAIR_LENGTH;
    } else {
      if (!isHighSurrogate(unit) && !isLowSurrogate(unit)) {
        result += text.charAt(index);
      }
      index += 1;
    }
  }
  return result;
};

/** whether `value` is a valid search text limit: a positive safe integer. */
export const isSearchQueryMaxLength = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

/**
 * the query to send for the search field text `raw`, or null when there is nothing to search.
 * lone surrogates are removed, the text is trimmed, cut at `maxLength` utf-16 code units (one unit
 * earlier when the cut would split a surrogate pair) and trimmed again at the end. preparing the
 * result again returns it unchanged. throws a RangeError when `maxLength` is not a positive safe
 * integer.
 */
export const prepareSearchQuery = (raw: string, maxLength: number): string | null => {
  if (!isSearchQueryMaxLength(maxLength)) {
    throw new RangeError('Search query max length must be a positive safe integer');
  }
  let text = withoutLoneSurrogates(raw).trim();
  if (text.length > maxLength) {
    // the text is well-formed: a high surrogate at the cut is the first half of a pair
    const end = isHighSurrogate(text.charCodeAt(maxLength - 1)) ? maxLength - 1 : maxLength;
    text = text.slice(0, end).trimEnd();
  }
  return text === '' ? null : text;
};
