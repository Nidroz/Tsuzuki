// collects the testIDs the app source can produce, from the typescript syntax tree of each file
// (ts.createSourceFile, no program). only testID positions count: a JSX attribute, a property, a
// variable, a parameter, a destructured prop or a function whose name holds `testID` (testID,
// testIDPrefix, filtersTestID, TEST_ID, libraryEntryTestID...). there, string literals,
// no-substitution templates and template expressions are candidates, through conditionals,
// logical operators, calls of a const function and const variables of the same file. an
// interpolation of a `const` string of the same file is resolved; any other one is a wildcard.
// each candidate knows the component it is written in and, when it starts with an interpolated
// prop (`${testID}-error`), that prop; each JSX testID attribute records what the element passes,
// so test-ids.mjs can follow a prop to the values the callers give it

import ts from 'typescript';

/** an unresolved interpolation in a candidate's parts */
export const WILDCARD = null;

const TEST_ID_NAME = /test_?id/i;
const COMPONENT_NAME = /^[A-Z]/;
const BOTH_SIDES_OPERATORS = new Set([
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

const unwrap = (node) => {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};

const isConstDeclaration = (node) =>
  ts.isVariableDeclaration(node) &&
  ts.isIdentifier(node.name) &&
  node.initializer !== undefined &&
  ts.isVariableDeclarationList(node.parent) &&
  (node.parent.flags & ts.NodeFlags.Const) !== 0;

const nameOf = (name) =>
  name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : null;

const hasTestIdName = (name) => TEST_ID_NAME.test(nameOf(name) ?? '');

// the component a node is written in: the nearest enclosing function named like a component
const ownerOf = (node) => {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    let name = null;
    if (ts.isFunctionDeclaration(current)) {
      name = nameOf(current.name);
    } else if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent)
    ) {
      name = nameOf(current.parent.name);
    }
    if (name !== null && COMPONENT_NAME.test(name)) {
      return name;
    }
  }
  return null;
};

// the tag of the JSX element whose attributes hold `node` (a spread object included), else null
const elementTagOf = (node) => {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (ts.isJsxAttributes(current)) {
      return current.parent.tagName.getText();
    }
    if (ts.isFunctionLike(current) || ts.isBlock(current)) {
      return null;
    }
  }
  return null;
};

// the component whose parameters destructure `node`, else null
const parameterOwnerOf = (node) => {
  let current = node.parent;
  while (current !== undefined && ts.isBindingPattern(current)) {
    current = current.parent.parent;
  }
  return current !== undefined && ts.isParameter(current) ? ownerOf(current) : null;
};

// the expression of a testID position and the prop it sets, or null
const testIdPosition = (node) => {
  if (ts.isJsxAttribute(node) && hasTestIdName(node.name)) {
    const value = node.initializer;
    const expression = value !== undefined && ts.isJsxExpression(value) ? value.expression : value;
    return { expression, target: { component: elementTagOf(node), prop: nameOf(node.name) } };
  }
  if ((ts.isPropertyAssignment(node) || ts.isBindingElement(node)) && hasTestIdName(node.name)) {
    const component = ts.isBindingElement(node) ? parameterOwnerOf(node) : elementTagOf(node);
    return { expression: node.initializer, target: { component, prop: nameOf(node.name) } };
  }
  if (ts.isShorthandPropertyAssignment(node) && hasTestIdName(node.name)) {
    return {
      expression: node.name,
      target: { component: elementTagOf(node), prop: node.name.text },
    };
  }
  if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && hasTestIdName(node.name)) {
    return { expression: node.initializer, target: null };
  }
  if (ts.isFunctionDeclaration(node) && hasTestIdName(node.name)) {
    return { expression: node.body, target: null };
  }
  return null;
};

// the returned expressions of a function body, nested functions left out
const returnedExpressions = (block) => {
  const found = [];
  const visit = (node) => {
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      found.push(node.expression);
    } else if (!ts.isFunctionLike(node)) {
      ts.forEachChild(node, visit);
    }
  };
  ts.forEachChild(block, visit);
  return found;
};

// adjacent literals joined, empty literals dropped
const normalize = (parts) =>
  parts.reduce((result, part) => {
    const last = result.at(-1);
    if (part === '') {
      return result;
    }
    if (typeof part === 'string' && typeof last === 'string') {
      result[result.length - 1] = `${last}${part}`;
    } else if (!(part === WILDCARD && last === WILDCARD)) {
      result.push(part);
    }
    return result;
  }, []);

const collectFile = ({ fileName, text }, collected) => {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const constInitializers = new Map();
  const positions = [];
  const visit = (node) => {
    if (isConstDeclaration(node)) {
      const name = node.name.text;
      constInitializers.set(name, [...(constInitializers.get(name) ?? []), node.initializer]);
      // const Row = memo(RowView): an element <Row> renders the component RowView
      const call = unwrap(node.initializer);
      const [argument] = ts.isCallExpression(call) ? call.arguments : [];
      if (argument !== undefined && ts.isIdentifier(argument) && COMPONENT_NAME.test(name)) {
        collected.aliases.push([name, argument.text]);
      }
    }
    const position = testIdPosition(node);
    if (position !== null) {
      positions.push(position);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const constInitializer = (name) => {
    const initializers = constInitializers.get(name);
    return initializers?.length === 1 ? initializers[0] : undefined;
  };

  // a const string of this file: its value, else null
  const resolveConst = (name, seen) => {
    const initializer = constInitializer(name);
    if (initializer === undefined || seen.has(name)) {
      return null;
    }
    const node = unwrap(initializer);
    if (!ts.isStringLiteralLike(node) && !ts.isTemplateExpression(node)) {
      return null;
    }
    const { parts } = candidateOf(node, new Set([...seen, name]));
    return parts.every((part) => typeof part === 'string') ? parts.join('') : null;
  };

  const candidateOf = (node, seen) => {
    const owner = ownerOf(node);
    if (!ts.isTemplateExpression(node)) {
      return { parts: [node.text], lead: null, owner };
    }
    const parts = [node.head.text];
    let lead = null;
    node.templateSpans.forEach((span, index) => {
      const expression = unwrap(span.expression);
      const value = ts.isIdentifier(expression) ? resolveConst(expression.text, seen) : null;
      if (index === 0 && node.head.text === '' && value === null && ts.isIdentifier(expression)) {
        lead = expression.text;
      }
      parts.push(value ?? WILDCARD, span.literal.text);
    });
    return { parts: normalize(parts), lead, owner };
  };

  // the values an expression can give: candidates, and props it forwards
  const valuesOf = (raw, seen) => {
    if (raw === undefined) {
      return [];
    }
    const node = unwrap(raw);
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      return [candidateOf(node, seen)];
    }
    if (ts.isIdentifier(node)) {
      const initializer = constInitializer(node.text);
      if (initializer === undefined) {
        return [{ forward: { component: ownerOf(node), prop: node.text } }];
      }
      return seen.has(node.text) ? [] : valuesOf(initializer, new Set([...seen, node.text]));
    }
    if (ts.isConditionalExpression(node)) {
      return [...valuesOf(node.whenTrue, seen), ...valuesOf(node.whenFalse, seen)];
    }
    if (ts.isBinaryExpression(node)) {
      const both = BOTH_SIDES_OPERATORS.has(node.operatorToken.kind);
      return [...valuesOf(node.right, seen), ...(both ? valuesOf(node.left, seen) : [])];
    }
    if (ts.isCallExpression(node)) {
      return valuesOf(node.expression, seen);
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      return valuesOf(node.body, seen);
    }
    if (ts.isBlock(node)) {
      return returnedExpressions(node).flatMap((expression) => valuesOf(expression, seen));
    }
    return [];
  };

  for (const { expression, target } of positions) {
    const values = valuesOf(expression, new Set());
    collected.candidates.push(...values.filter((value) => value.forward === undefined));
    if (target !== null && target.component !== null && target.prop !== null) {
      collected.attributes.push(...values.map((value) => ({ ...target, value })));
    }
  }
};

/**
 * the testIDs of `sources` ({ fileName, text }): `candidates` ({ parts, lead, owner }, parts an
 * array of literals and WILDCARD), `attributes` ({ component, prop, value }: what an element or a
 * prop default gives a testID prop, a candidate or `{ forward: { component, prop } }`, a prop of
 * the enclosing component passed on) and `aliases` ([element, component] pairs, from memo)
 */
export const collectTestIds = (sources) => {
  const collected = { candidates: [], attributes: [], aliases: [] };
  for (const source of sources) {
    collectFile(source, collected);
  }
  return collected;
};
