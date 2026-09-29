// esquery selector helpers shared by the no-restricted-syntax tables (layer guards and test hygiene):
// they match a name however it is spelled statically; a name computed at run time stays out of
// reach of any static check

// esquery regex matching exactly one of the names
export const oneOf = (names) => `/^(?:${names.join('|')})$/`;

// esquery regex literals cannot contain "/", even escaped
export const toSelectorRegex = (regex) => `/${regex.replaceAll('/', '\\x2F')}/i`;

// the static name of a property key: a non-computed identifier ({ skip }), a string, plain or
// computed ({ 'skip': x }, { ['skip']: x }) or a computed expression-free template ({ [`skip`]: x })
export const propertyKey = (pattern) =>
  `Property:matches(${[
    `[computed=false][key.name=${pattern}]`,
    `[key.value=${pattern}]`,
    `[computed=true][key.type='TemplateLiteral'][key.expressions.length=0][key.quasis.0.value.cooked=${pattern}]`,
  ].join(', ')})`;

// the static name of a member expression's property at path (e.g. "callee."): a non-computed
// identifier (x.skip), a computed string (x['skip']) or an expression-free template (x[`skip`])
export const memberName = (pattern, at = '') =>
  `:matches(${[
    `[${at}computed=false][${at}property.name=${pattern}]`,
    `[${at}computed=true][${at}property.value=${pattern}]`,
    `[${at}computed=true][${at}property.type='TemplateLiteral'][${at}property.expressions.length=0][${at}property.quasis.0.value.cooked=${pattern}]`,
  ].join(', ')})`;
