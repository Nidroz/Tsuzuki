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
// accessibilityRole, name, href, icon) is no text.
// limits of a syntax check: a string stored in a variable or constant first and then passed by
// name, a label function with a block body, and a key computed at run time stay out of reach

import { memberName, oneOf, propertyKey } from './selectors.mjs';

const TEXT_RULE = 'CONTRIBUTING.md section 5';
const TEXT_MESSAGE = `routes and features show no hard-coded user-facing text: use t('key') from @core/i18n, with the key in en.json and fr.json (${TEXT_RULE}).`;

const LETTER = '/\\p{L}/u';
const TEXT_LITERAL = `:matches(Literal[value=${LETTER}], TemplateLiteral:has(> TemplateElement[value.cooked=${LETTER}]))`;

// the props and object keys that hold text: a text word, or a name ending in one (accessibilityLabel,
// loadingLabel, headerTitle, emptyText). covers every text prop of the src/ui primitives: label,
// loadingLabel, title, message, placeholder, error, accessibilityLabel, accessibilityHint, and the
// label of the EmptyState action and the ErrorState retry objects
const TEXT_WORDS = ['label', 'title', 'placeholder', 'message', 'description', 'text', 'hint'];
const TEXT_SUFFIXES = ['Label', 'Hint', 'Title', 'Text', 'Message', 'Placeholder', 'Description'];
const TEXT_KEY = `/^(?:${[...TEXT_WORDS, 'error'].join('|')}|[a-z][A-Za-z]*(?:${TEXT_SUFFIXES.join('|')}))$/`;
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
// an operand of && || ??, a concatenation, a template, a type assertion and the expression body of a
// label function, nested up to MAX_NESTING deep
const TEXT_WRAPPERS = `:matches(${[
  'ConditionalExpression',
  'LogicalExpression',
  "BinaryExpression[operator='+']",
  'TemplateLiteral',
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

const IN_JSX_PROPS = ':matches(JSXAttribute, JSXSpreadAttribute)';
const ALERT_CALL = `CallExpression[callee.type='MemberExpression']${memberName(oneOf(['alert', 'prompt']), 'callee.')}:matches([callee.object.name='Alert'], [callee.object.property.name='Alert'])`;

const TEXT_SLOTS = [
  // <Text>Hello</Text>
  `JSXText[value=${LETTER}]`,
  // <Text>{'Hello'}</Text>, <Text>{ok ? 'Yes' : t('no')}</Text>
  ...textIn(':matches(JSXElement, JSXFragment) > JSXExpressionContainer'),
  // label="Save", label={ok ? 'Yes' : 'No'}
  `JSXAttribute[name.name=${TEXT_KEY}] > ${TEXT_LITERAL}`,
  ...textIn(`JSXAttribute[name.name=${TEXT_KEY}] > JSXExpressionContainer`),
  // text keys of objects given or spread as props, however deep: action={{ label: 'Retry' }},
  // {...(ok && { label: 'Save' })}, options={{ title: 'Home' }}
  ...textIn(`${IN_JSX_PROPS} ${propertyKey(TEXT_KEY)}`, '.value'),
  // labels={{ next: 'Next', page: (n) => 'Page' }}, {...{ labels: { next: 'Next' } }}
  ...textIn(
    `JSXAttribute[name.name=${LABELS_KEY}] > JSXExpressionContainer > ObjectExpression > Property`,
    '.value',
  ),
  ...textIn(
    `${IN_JSX_PROPS} ${propertyKey(LABELS_KEY)} > ObjectExpression.value > Property`,
    '.value',
  ),
  // navigation options anywhere: const options = { title: 'Home' }, navigation.setOptions(...)
  ...textIn(propertyKey(NAVIGATION_KEY), '.value'),
  // alert arguments and button text: Alert.alert('Oops'), Alert.alert(t('a'), t('b'), [{ text: 'OK' }])
  ...textIn(ALERT_CALL),
  ...textIn(`${ALERT_CALL} ${propertyKey(TEXT_KEY)}`, '.value'),
];

// one selector, so a literal in several slots (options={{ title: 'Home' }}) is reported once
export const TEXT_GUARDS = [
  { selector: `:matches(${TEXT_SLOTS.join(', ')})`, message: TEXT_MESSAGE },
];
