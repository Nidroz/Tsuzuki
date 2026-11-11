// what a maestro step selects by text and the links it opens, read from its parsed yaml
// (maestro-flows.mjs), for the deletion guard (deletion-guard.mjs)

const TEXT = 'text';
const OPEN_LINK = 'openLink';
const LINK = 'link';
// typed text, not a selector
const INPUT_TEXT = 'inputText';
// the keys whose string value is a text selector: the commands taking a selector, then the
// selectors nested in a command (scrollUntilVisible, swipe), a wait or a condition (visible,
// notVisible) and the relative selectors
const SELECTOR_KEYS = new Set([
  'tapOn',
  'doubleTapOn',
  'longPressOn',
  'assertVisible',
  'assertNotVisible',
  'copyTextFrom',
  'scrollUntilVisible',
  'element',
  'from',
  'visible',
  'notVisible',
  'below',
  'above',
  'leftOf',
  'rightOf',
  'childOf',
  'containsChild',
  'containsDescendants',
]);

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// the string items of a selector list (containsDescendants) are text selectors too
const selectorItems = (key, child) =>
  SELECTOR_KEYS.has(key) && Array.isArray(child)
    ? child.filter((item) => typeof item === 'string')
    : [];

/**
 * every text selector of a value, nested ones included: each `text:` string, and the string given
 * where a selector goes (`tapOn: Delete account`, `visible: Development Build`). an `inputText`
 * types its text: left out
 */
export const textSelectorsOf = (value) => {
  if (Array.isArray(value)) {
    return value.flatMap(textSelectorsOf);
  }
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) => {
    if (key === INPUT_TEXT) {
      return [];
    }
    if (typeof child === 'string') {
      return key === TEXT || SELECTOR_KEYS.has(key) ? [child] : [];
    }
    return [...selectorItems(key, child), ...textSelectorsOf(child)];
  });
};

/** every openLink target of a value, nested ones included: `openLink: <link>` or its `link:` */
export const linksOf = (value) => {
  if (Array.isArray(value)) {
    return value.flatMap(linksOf);
  }
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) => {
    if (key === OPEN_LINK && typeof child === 'string') {
      return [child];
    }
    if (key === OPEN_LINK && isRecord(child) && typeof child[LINK] === 'string') {
      return [child[LINK]];
    }
    return linksOf(child);
  });
};
