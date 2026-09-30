// no-restricted-syntax guards of the layer rules (tools/eslint/layers.mjs): literal import()
// sources, the catalog provider url, className outside src/ui, direct styling in routes and
// features, and the jest module calls, which load or mock a module by its specifier like an import,
// called by name directly on jest (CONTRIBUTING.md section 4)

import { memberName, oneOf, propertyKey, toSelectorRegex } from './selectors.mjs';

export const LAYERS_RULE = 'CONTRIBUTING.md section 4';

// a non-literal import() source would bypass every import rule; metro bundles only literal sources
export const LITERAL_IMPORT_GUARD = {
  selector: "ImportExpression:not([source.type='Literal'])",
  message: `import() takes a string literal so layer rules can check it (${LAYERS_RULE}).`,
};

const JIKAN_MESSAGE = `the catalog provider is reached only through its adapter in src/core/catalog/jikan (${LAYERS_RULE}).`;
export const JIKAN_GUARDS = [
  { selector: 'Literal[value=/jikan\\.moe/i]', message: JIKAN_MESSAGE },
  { selector: 'TemplateElement[value.raw=/jikan\\.moe/i]', message: JIKAN_MESSAGE },
];

// className and its variants (contentContainerClassName, ...) as JSX props or object keys (spread
// props, createElement props, destructuring), however the key is spelled statically; the word as a
// string value stays allowed. a member assignment (props.className = 'x') and a key computed at run
// time stay out of reach of static checks
const CLASS_NAME_MESSAGE = `className is used only inside src/ui, the only layer that uses NativeWind (${LAYERS_RULE}).`;
const CLASS_NAME_PATTERN = '/^(?:[a-z][A-Za-z]*C|c)lassName$/';
export const CLASS_NAME_GUARDS = [
  { selector: `JSXAttribute[name.name=${CLASS_NAME_PATTERN}]`, message: CLASS_NAME_MESSAGE },
  { selector: propertyKey(CLASS_NAME_PATTERN), message: CLASS_NAME_MESSAGE },
];

// direct styling in routes and features: StyleSheet reached from react-native (named import,
// re-export, destructuring or a member read on any object, such as a namespace import), any member
// read on a StyleSheet (StyleSheet.create), and style or *Style JSX props given an expression,
// directly or in an object literal spread as props. a string literal is a mode, not a style
// (<StatusBar style="auto" />), and other object keys stay allowed (navigation options such as
// tabBarStyle)
const STYLE_MESSAGE = `routes and features never style directly (StyleSheet, style props): they compose src/ui primitives, which own the styling with theme tokens (${LAYERS_RULE}).`;
const REACT_NATIVE = 'react-native';
const STYLE_SHEET = 'StyleSheet';
const STYLE_SHEET_PATTERN = `/^${STYLE_SHEET}$/`;
const STYLE_PROP_PATTERN = '/^(?:[a-z][A-Za-z]*S|s)tyle$/';
// object literals spread as JSX props: directly, or as an operand of && / || / ?? or a ternary
const SPREAD_OBJECTS = [
  'JSXSpreadAttribute > ObjectExpression',
  'JSXSpreadAttribute > LogicalExpression > ObjectExpression',
  'JSXSpreadAttribute > ConditionalExpression > ObjectExpression',
];

export const STYLE_GUARDS = [
  {
    selector: `ImportDeclaration[source.value='${REACT_NATIVE}'] > ImportSpecifier:matches([imported.name='${STYLE_SHEET}'], [imported.value='${STYLE_SHEET}'])`,
    message: STYLE_MESSAGE,
  },
  {
    selector: `ExportNamedDeclaration[source.value='${REACT_NATIVE}'] > ExportSpecifier:matches([local.name='${STYLE_SHEET}'], [local.value='${STYLE_SHEET}'])`,
    message: STYLE_MESSAGE,
  },
  // const { StyleSheet } = RN
  { selector: `ObjectPattern > ${propertyKey(STYLE_SHEET_PATTERN)}`, message: STYLE_MESSAGE },
  // a member read on any object: RN.StyleSheet, RN['StyleSheet']
  { selector: `MemberExpression${memberName(STYLE_SHEET_PATTERN)}`, message: STYLE_MESSAGE },
  // any member read on it, however it got there: StyleSheet.create, StyleSheet['flatten']
  {
    selector: `MemberExpression[object.type='Identifier'][object.name='${STYLE_SHEET}']`,
    message: STYLE_MESSAGE,
  },
  {
    selector: `JSXAttribute[name.name=${STYLE_PROP_PATTERN}][value.type='JSXExpressionContainer']`,
    message: STYLE_MESSAGE,
  },
  // the same props in an object literal spread as props, directly or behind a condition, however
  // the key is spelled statically: <Box {...{ style }} />, <Box {...(flag && { style: x })} />
  {
    selector: `:matches(${SPREAD_OBJECTS.join(', ')}) > ${propertyKey(STYLE_PROP_PATTERN)}`,
    message: STYLE_MESSAGE,
  },
];

// every jest function that loads or mocks a module by its specifier: its first argument follows the
// package bans of the layer, like an import. unstable_unmockModule is not in the jest 29.7 typings
// (@jest/environment) yet; it stays listed so a later jest cannot slip it past the guards
const JEST = 'jest';
const JEST_GLOBALS = '@jest/globals';
const JEST_MODULE_METHODS = [
  'mock',
  'doMock',
  'unmock',
  'deepUnmock',
  'dontMock',
  'setMock',
  'requireActual',
  'requireMock',
  'unstable_mockModule',
  'unstable_unmockModule',
  'createMockFromModule',
];
// the jest methods typed as returning the jest object in the jest 29.7 typings (@jest/environment):
// a member read on their result reaches jest on a call result, out of reach of the guards below
const JEST_RETURNING_METHODS = [
  'autoMockOff',
  'autoMockOn',
  'clearAllMocks',
  'deepUnmock',
  'disableAutomock',
  'doMock',
  'dontMock',
  'enableAutomock',
  'isolateModules',
  'mock',
  'resetAllMocks',
  'resetModules',
  'restoreAllMocks',
  'retryTimes',
  'setMock',
  'setTimeout',
  'unmock',
  'unstable_mockModule',
  'useFakeTimers',
  'useRealTimers',
];
const JEST_OBJECT = `[object.type='Identifier'][object.name='${JEST}']`;
// a module method read by name on jest: jest.mock
const JEST_MODULE_METHOD = `MemberExpression${JEST_OBJECT}[computed=false][property.name=${oneOf(JEST_MODULE_METHODS)}]`;
// a direct call of a method by name, optional or not: jest.mock(...), jest?.mock(...), jest.mock?.(...)
const jestCall = (methods) =>
  `CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='${JEST}'][callee.computed=false][callee.property.name=${oneOf(methods)}]`;
const JEST_MODULE_CALL = jestCall(JEST_MODULE_METHODS);
const JEST_RETURNING_CALL = jestCall(JEST_RETURNING_METHODS);
// the nodes that hand their expression on unchanged: (jest.x?.()).y, jest.x()!.y, (jest.x() as T).y
const TRANSPARENT_WRAPPERS = [
  'ChainExpression',
  'TSNonNullExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
];

// any other first argument (template literal, identifier, concatenation, spread) would hide the
// specifier from the package bans, like a non-literal import() source; a string value only exists
// on a string literal
const JEST_LITERAL_GUARD = {
  selector: `${JEST_MODULE_CALL}:not([arguments.0.type='Literal'][arguments.0.value=/^/])`,
  message: `jest module calls take a string literal so layer rules can check them: ${JEST_MODULE_METHODS.join(', ')} (${LAYERS_RULE}).`,
};

// the guards above follow the name jest: an alias, a namespace or a jest reached through another
// object would hide the module calls from them
const JEST_NAME_MESSAGE = `jest is imported and used under its own name: import { jest } from '${JEST_GLOBALS}' (${LAYERS_RULE}).`;
const JEST_NAME_GUARDS = [
  // export * and export * as g hand jest to another module under a name the guards do not follow
  { selector: `ExportAllDeclaration[source.value='${JEST_GLOBALS}']`, message: JEST_NAME_MESSAGE },
  // export { 'jest' as j } from: a string name has no identifier for the value guard below
  {
    selector: `ExportNamedDeclaration[source.value='${JEST_GLOBALS}'] > ExportSpecifier[local.value='${JEST}']`,
    message: JEST_NAME_MESSAGE,
  },
  {
    selector: `ImportDeclaration[source.value='${JEST_GLOBALS}'] > :matches(ImportSpecifier:matches([imported.name='${JEST}'], [imported.value='${JEST}']):not([local.name='${JEST}']), ImportNamespaceSpecifier, ImportDefaultSpecifier)`,
    message: JEST_NAME_MESSAGE,
  },
  // import('@jest/globals') and jest.requireActual('@jest/globals') hand out jest as a value
  {
    selector: `:matches(ImportExpression[source.value='${JEST_GLOBALS}'], ${JEST_MODULE_CALL}[arguments.0.value='${JEST_GLOBALS}'])`,
    message: JEST_NAME_MESSAGE,
  },
  {
    selector: `MemberExpression[object.name=/^(?:globalThis|global|window|self)$/]${memberName(`/^${JEST}$/`)}`,
    message: JEST_NAME_MESSAGE,
  },
];

// the positions where the name jest is no value: the object of a non-computed member (jest.fn),
// a property or key name (x.jest, { jest: x }), an import specifier and the type positions
// (typeof jest.fn, jest.Mocked<T>). a shorthand key ({ jest }) is its value too, whatever the parser
const JEST_NAME_POSITIONS = [
  'MemberExpression[computed=false] > .object',
  'MemberExpression[computed=false] > .property',
  ':matches(Property, PropertyDefinition, MethodDefinition, AccessorProperty, TSPropertySignature, TSMethodSignature)[computed=false][shorthand!=true] > .key',
  'ImportSpecifier > Identifier',
  'TSQualifiedName > Identifier',
  'TSTypeQuery > .exprName',
];
const JEST_BY_NAME_MESSAGE = `jest methods are called by name, directly on jest: jest.mock('x'), so layer rules can check them (${LAYERS_RULE}).`;
const JEST_BY_NAME_GUARDS = [
  // jest['mock'](...), jest[method](...)
  { selector: `MemberExpression${JEST_OBJECT}[computed=true]`, message: JEST_BY_NAME_MESSAGE },
  // jest as a value: aliased, destructured, passed as an argument
  {
    selector: `Identifier[name='${JEST}']:not(${JEST_NAME_POSITIONS.join(', ')})`,
    message: JEST_BY_NAME_MESSAGE,
  },
  // a module method read as a value is called without the guards seeing its first argument:
  // jest.mock.call(jest, 'x'), jest.requireActual.bind(jest)('x'), (0, jest.mock)('x')
  {
    selector: `${JEST_MODULE_METHOD}:not(CallExpression > .callee)`,
    message: JEST_BY_NAME_MESSAGE,
  },
  // any member read on a returned jest, called or not, plain, optional or computed, directly or
  // through one wrapper: jest.resetModules().mock('x'), jest.resetModules()?.['mock']('x'),
  // (jest.resetModules?.()).mock('x'). out of reach of syntax: a returned jest kept in a variable,
  // behind a sequence ((0, jest.resetModules()).mock) or called through .call/.apply/.bind
  {
    selector: `:matches(MemberExpression > ${JEST_RETURNING_CALL}.object, MemberExpression > :matches(${TRANSPARENT_WRAPPERS.join(', ')}).object > ${JEST_RETURNING_CALL}.expression)`,
    message: JEST_BY_NAME_MESSAGE,
  },
];

// the jest guards of every layer; jestModuleBans adds its package bans
export const JEST_GUARDS = [JEST_LITERAL_GUARD, ...JEST_NAME_GUARDS, ...JEST_BY_NAME_GUARDS];

// the package bans on the first argument of the jest module calls
export const jestModuleBans = (banned) =>
  banned.flatMap(({ regexes, message }) =>
    regexes.map((regex) => ({
      selector: `${JEST_MODULE_CALL}[arguments.0.value=${toSelectorRegex(regex)}]`,
      message,
    })),
  );
