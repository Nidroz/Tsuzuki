// no-restricted-syntax guards of the layer rules (tools/eslint/layers.mjs): literal import()
// sources, the catalog provider url, className outside src/ui, and the jest module calls, which load
// or mock a module by its specifier like an import (CONTRIBUTING.md section 4)

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

// every jest function that loads or mocks a module by its specifier: its first argument follows the
// package bans of the layer, like an import
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
const JEST_OBJECT = `[object.type='Identifier'][object.name='${JEST}']`;
// a module method read by name on jest: jest.mock
const JEST_MODULE_METHOD = `MemberExpression${JEST_OBJECT}[computed=false][property.name=${oneOf(JEST_MODULE_METHODS)}]`;
// a direct call of it, optional or not: jest.mock(...), jest?.mock(...), jest.mock?.(...)
const JEST_MODULE_CALL = `CallExpression[callee.type='MemberExpression'][callee.object.type='Identifier'][callee.object.name='${JEST}'][callee.computed=false][callee.property.name=${oneOf(JEST_MODULE_METHODS)}]`;

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
