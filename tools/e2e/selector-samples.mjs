// the concrete ids standing for the regex of a maestro `id:` selector, so a selector can be checked
// against the testIDs of the source (test-ids.mjs)

// the sample segments a regex wildcard stands for: one to three dash-separated segments
const SAMPLE_SEGMENTS = ['x0', 'x0-x0', 'x0-x0-x0'];
const SAMPLE_DIGIT = '0';
const SAMPLE_WORD = 'x';
const QUANTIFIERS = new Set(['*', '+', '?']);
const UNSUPPORTED_REGEX = new Set(['*', '+', '?', '(', ')', '|', '{', '}', '^', '$']);

const skipQuantifier = (selector, index) =>
  QUANTIFIERS.has(selector.charAt(index)) ? index + 1 : index;

// every combination of the choices of each position, joined
const combine = (positions) =>
  positions.reduce(
    (samples, choices) => samples.flatMap((sample) => choices.map((choice) => sample + choice)),
    [''],
  );

/**
 * the concrete ids standing for `selector`: `.*` and `.+` become one to three sample segments,
 * `\d` a digit, a character class its first character, an escaped character itself. groups,
 * alternatives, anchors and other quantifiers throw: the flows do not use them
 */
export const selectorSamples = (selector) => {
  const positions = [];
  let index = 0;
  while (index < selector.length) {
    const char = selector.charAt(index);
    if (char === '.') {
      const quantified = QUANTIFIERS.has(selector.charAt(index + 1));
      positions.push(quantified ? SAMPLE_SEGMENTS : [SAMPLE_WORD]);
      index = skipQuantifier(selector, index + 1);
    } else if (char === '\\') {
      const escaped = selector.charAt(index + 1);
      if (escaped === 'd') {
        positions.push([SAMPLE_DIGIT]);
      } else if (escaped === 'w' || escaped === 'S') {
        positions.push([SAMPLE_WORD]);
      } else {
        positions.push([escaped]);
      }
      index = skipQuantifier(selector, index + 2);
    } else if (char === '[') {
      const end = selector.indexOf(']', index + 2);
      const first = selector.charAt(index + 1);
      if (end === -1 || first === '^' || first === '\\') {
        throw new Error(`unsupported character class in the selector ${selector}`);
      }
      positions.push([first]);
      index = skipQuantifier(selector, end + 1);
    } else if (UNSUPPORTED_REGEX.has(char)) {
      throw new Error(`unsupported regex syntax "${char}" in the selector ${selector}`);
    } else {
      positions.push([char]);
      index += 1;
    }
  }
  return combine(positions);
};
