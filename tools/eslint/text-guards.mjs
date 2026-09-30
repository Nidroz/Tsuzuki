// no-restricted-syntax guards of the layer rules (tools/eslint/layers.mjs) against hard-coded
// user-facing text in routes and features: they show text through t('key') from @core/i18n
// (CONTRIBUTING.md section 5). next to the style guards of tools/eslint/syntax-guards.mjs, split out
// to keep each module short
//
// text is a string literal, or a template literal with a quasi, holding a letter in any script;
// punctuation, digits and spaces stay allowed (<Text>·</Text>, label="42"). it is reported where it
// is shown: a JSX child, a text prop, a text key of an object given or spread as props, a value of a
// labels object, a navigation option anywhere in the file, and an alert's arguments and buttons.
// a string literal as a call argument (t('home.title')) or a non-text prop (testID, variant,
// accessibilityRole, name, href, icon) is no text, and neither is a text key inside a function or a
// call's arguments within a prop or an alert (onPress={() => track({ label: 'save' })}): that is
// the data of the code it runs, not text the prop shows.
// limits of a syntax check: a string stored in a variable or constant first and then passed by
// name, a label function with a block body, a key computed at run time, a literal behind more than
// MAX_NESTING wrappers, and a text key more than MAX_OBJECT_PATH nodes deep in a prop's objects and
// arrays stay out of reach; a navigation key is text wherever it is written, even in another call's
// data (track({ title: 'opened' }))

import { memberName, oneOf, propertyKey } from './selectors.mjs';

const TEXT_RULE = 'CONTRIBUTING.md section 5';
const TEXT_MESSAGE = `routes and features show no hard-coded user-facing text: use t('key') from @core/i18n, with the key in en.json and fr.json (${TEXT_RULE}).`;

const LETTER = '/\\p{L}/u';
const TEXT_LITERAL = `:matches(Literal[value=${LETTER}], TemplateLiteral:has(> TemplateElement[value.cooked=${LETTER}]))`;

// the props and object keys that hold text: a text word, or a name ending in one (accessibilityLabel,
// loadingLabel, headerTitle, emptyText), and the react native aria props that hold text
// (aria-labelledby holds a nativeID). covers every text prop of the src/ui primitives: label,
// loadingLabel, title, message, placeholder, error, accessibilityLabel, accessibilityHint, and the
// label of the EmptyState action and the ErrorState retry objects
const TEXT_WORDS = ['label', 'title', 'placeholder', 'message', 'description', 'text', 'hint'];
const TEXT_SUFFIXES = ['Label', 'Hint', 'Title', 'Text', 'Message', 'Placeholder', 'Description'];
const ARIA_TEXT_PROPS = ['aria-label', 'aria-valuetext'];
const TEXT_KEY = `/^(?:${[...TEXT_WORDS, 'error', ...ARIA_TEXT_PROPS].join('|')}|[a-z][A-Za-z]*(?:${TEXT_SUFFIXES.join('|')}))$/`;
// objects whose every value is text, such as the Pagination labels
const LABELS_KEY = '/^(?:labels|[a-z][A-Za-z]*Labels)$/';
// the react navigation options that are shown as text, whatever object holds them
const NAVIGATION_KEY = oneOf([
  'title',
  'headerTitle',
  'headerBackTitle',
  'tabBarLabel',
  'tabBarAccessibilityLabel',
  'drawerLabel',
]);

// the expressions that hand a string on as their value: a branch of a condition (never its test),
// an operand of && || ??, a concatenation, a template, an array element, a type assertion and the
// expression body of a label function, nested up to MAX_NESTING deep
const TEXT_WRAPPERS = `:matches(${[
  'ConditionalExpression',
  'LogicalExpression',
  "BinaryExpression[operator='+']",
  'TemplateLiteral',
  'ArrayExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'ArrowFunctionExpression',
].join(', ')})`;
const MAX_NESTING = 3;
const NOT_TEST = ':not(.test)';

// the text literal at a slot: a child of parent (at field, if given), directly or through wrappers
const textIn = (parent, field = '') =>
  Array.from({ length: MAX_NESTING + 1 }, (_, depth) =>
    [
      parent,
      ...Array.from({ length: depth }, (__, level) => TEXT_WRAPPERS + (level ? NOT_TEST : field)),
      TEXT_LITERAL + (depth ? NOT_TEST : field),
    ].join(' > '),
  );

// the nodes between a prop (or an alert call) and the objects it holds: object values, array
// elements, spreads, branches and operands, type assertions. a function or a call ends the path, so
// the objects of a callback or of a call's arguments are not the prop's
const OBJECT_PATH = `:matches(${[
  'JSXExpressionContainer',
  'ObjectExpression',
  'Property',
  'ArrayExpression',
  'SpreadElement',
  'ConditionalExpression',
  'LogicalExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
].join(', ')})`;
const MAX_OBJECT_PATH = 6;

// the properties named key of the object literals held by owner, up to MAX_OBJECT_PATH nodes deep
const keysIn = (owner, key) =>
  `:matches(${Array.from({ length: MAX_OBJECT_PATH + 1 }, (_, depth) =>
    [owner, ...Array.from({ length: depth }, () => OBJECT_PATH), 'ObjectExpression', key].join(
      ' > ',
    ),
  ).join(', ')})`;

const IN_JSX_PROPS = ':matches(JSXAttribute, JSXSpreadAttribute)';
const ALERT_CALL = `CallExpression[callee.type='MemberExpression']${memberName(oneOf(['alert', 'prompt']), 'callee.')}:matches([callee.object.name='Alert'], [callee.object.property.name='Alert'])`;

const TEXT_SLOTS = [
  // <Text>Hello</Text>
  `JSXText[value=${LETTER}]`,
  // <Text>{'Hello'}</Text>, <Text>{ok ? 'Yes' : t('no')}</Text>, <Text>{['Hi', t('a')]}</Text>
  ...textIn(':matches(JSXElement, JSXFragment) > JSXExpressionContainer'),
  // label="Save", aria-label="Save", label={ok ? 'Yes' : 'No'}
  `JSXAttribute[name.name=${TEXT_KEY}] > ${TEXT_LITERAL}`,
  ...textIn(`JSXAttribute[name.name=${TEXT_KEY}] > JSXExpressionContainer`),
  // text keys of objects given or spread as props: action={{ label: 'Retry' }},
  // {...(ok && { label: 'Save' })}, accessibilityActions={[{ label: 'Open' }]}
  ...textIn(keysIn(IN_JSX_PROPS, propertyKey(TEXT_KEY)), '.value'),
  // labels={{ next: 'Next', page: (n) => 'Page' }}, {...{ labels: { next: 'Next' } }}
  ...textIn(
    `JSXAttribute[name.name=${LABELS_KEY}] > JSXExpressionContainer > ObjectExpression > Property`,
    '.value',
  ),
  ...textIn(
    `${keysIn(IN_JSX_PROPS, propertyKey(LABELS_KEY))} > ObjectExpression.value > Property`,
    '.value',
  ),
  // navigation options anywhere: const options = { title: 'Home' }, navigation.setOptions(...)
  ...textIn(propertyKey(NAVIGATION_KEY), '.value'),
  // alert arguments and button text: Alert.alert('Oops'), Alert.alert(t('a'), t('b'), [{ text: 'OK' }])
  ...textIn(ALERT_CALL),
  ...textIn(keysIn(ALERT_CALL, propertyKey(TEXT_KEY)), '.value'),
];

// one selector, so a literal in several slots (options={{ title: 'Home' }}) is reported once
export const TEXT_GUARDS = [
  { selector: `:matches(${TEXT_SLOTS.join(', ')})`, message: TEXT_MESSAGE },
];
