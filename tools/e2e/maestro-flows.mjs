// static checks of the maestro flows (e2e/README.md): each flow reads as the yaml subset, its
// subflows exist without a cycle, and every ${...} variable is defined by an env of the flow, of a
// runFlow or by the environment of `maestro test` (its MAESTRO_ variables). the selectors, the text
// selectors and the links are collected for the checks of the test (deletion-guard.mjs). nothing
// runs on a device

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { linksOf, textSelectorsOf } from './step-selectors.mjs';
import { readYamlSubset } from './yaml-subset.mjs';

export const APP_ID = 'io.github.nidroz.tsuzuki.dev';

/** the metro url override: optional, so every use must have a fallback (`METRO_URL || '...'`) */
export const METRO_URL = 'METRO_URL';
/**
 * the values the e2e workflow gives the ci flows (e2e/flows and the subflows they reach), as
 * environment variables of `maestro test`: maestro passes each MAESTRO_ one to the flows, so none
 * is on its command line
 */
export const CI_VARIABLES = ['MAESTRO_E2E_EMAIL', 'MAESTRO_E2E_PASSWORD', 'MAESTRO_E2E_RUN_ID'];
/** the values the owner exports for the manual flows (e2e/flows-manual): a throwaway account only */
export const MANUAL_VARIABLES = [
  'MAESTRO_E2E_THROWAWAY_EMAIL',
  'MAESTRO_E2E_THROWAWAY_PASSWORD',
  'MAESTRO_E2E_RUN_ID',
];
/** the shared test account: never reached by a manual flow, which may delete its account */
export const SHARED_ACCOUNT_VARIABLES = ['MAESTRO_E2E_EMAIL', 'MAESTRO_E2E_PASSWORD'];
/** the throwaway account: never reached by a ci flow */
export const THROWAWAY_VARIABLES = [
  'MAESTRO_E2E_THROWAWAY_EMAIL',
  'MAESTRO_E2E_THROWAWAY_PASSWORD',
];

const RUN_FLOW = 'runFlow';
const COMMANDS = 'commands';
const VARIABLE_PATTERN = /\$\{([^}]*)\}/g;
const QUOTED_PATTERN = /'[^']*'|"[^"]*"|`[^`]*`/g;
const IDENTIFIER_PATTERN = /[A-Za-z_$][\w$]*/g;
const UPPERCASE_IDENTIFIER = /^[A-Z][A-Z0-9_]*$/;
const METRO_URL_FALLBACK = /\bMETRO_URL\s*\|\|/;
const YAML_EXTENSION = '.yaml';

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** reads a flow file: its config document (appId, env, hooks) and its steps */
export const readFlow = (text) => {
  const documents = readYamlSubset(text);
  if (documents.length !== 2 || !isRecord(documents[0]) || !Array.isArray(documents[1])) {
    throw new Error('a flow is a config mapping, then `---`, then a list of steps');
  }
  return { config: documents[0], steps: documents[1] };
};

/** the yaml files directly inside `directory`, sorted, as absolute paths */
export const yamlFilesIn = (directory) =>
  existsSync(directory)
    ? readdirSync(directory)
        .filter((name) => name.endsWith(YAML_EXTENSION))
        .sort()
        .map((name) => path.join(directory, name))
    : [];

// every string of a value, nested ones included
const stringsOf = (value) => {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringsOf);
  }
  return isRecord(value) ? Object.values(value).flatMap(stringsOf) : [];
};

/** every `id:` selector of a value, nested ones included */
export const selectorsOf = (value) => {
  if (Array.isArray(value)) {
    return value.flatMap(selectorsOf);
  }
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    key === 'id' && typeof child === 'string' ? [child] : selectorsOf(child),
  );
};

/**
 * the uppercase identifiers read by the ${...} expressions of `text` (quoted strings left out),
 * with a problem for a METRO_URL read without a fallback
 */
export const variablesOf = (text) => {
  const names = [];
  const problems = [];
  for (const [, expression] of text.matchAll(VARIABLE_PATTERN)) {
    const code = expression.replace(QUOTED_PATTERN, '');
    const found = (code.match(IDENTIFIER_PATTERN) ?? []).filter((name) =>
      UPPERCASE_IDENTIFIER.test(name),
    );
    if (found.includes(METRO_URL) && !METRO_URL_FALLBACK.test(code)) {
      problems.push(`METRO_URL without a fallback in \${${expression}}`);
    }
    names.push(...found);
  }
  return { names, problems };
};

/**
 * `text` with each ${...} replaced by its value in `scope` (a name to its value, or null when
 * unknown): a variable of known value by that value, any other expression by the string literals
 * it holds, joined (its fallback, the parts of a concatenation), else nothing
 */
export const substituteVariables = (text, scope) =>
  text.replace(VARIABLE_PATTERN, (_, expression) => {
    const value = scope.get(expression.trim());
    if (typeof value === 'string') {
      return value;
    }
    return (expression.match(QUOTED_PATTERN) ?? []).map((quoted) => quoted.slice(1, -1)).join('');
  });

// the variables an env mapping defines, each with its value substituted in `scope`
const envScope = (env, scope) =>
  isRecord(env)
    ? Object.entries(env).map(([name, value]) => [
        name,
        typeof value === 'string' ? substituteVariables(value, scope) : String(value),
      ])
    : [];

const defaultLoad = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

/**
 * analyzes the flow `entry` and the subflows it reaches through runFlow, with `external` the
 * variables given to `maestro test` (values unknown). returns the files reached (entry first), the
 * `id:` selectors, the text selectors and the openLink targets (their variables substituted,
 * substituteVariables) and the variables used, each with its file, and the problems: unreadable or
 * missing files, a cycle, an undefined variable. `load(file)` returns a file's text, or null when
 * it is missing
 */
export const analyzeFlow = (entry, { external, load = defaultLoad }) => {
  const files = [];
  const selectors = [];
  const texts = [];
  const links = [];
  const variables = [];
  const problems = [];

  const useVariables = (value, defined, file) => {
    for (const text of stringsOf(value)) {
      const { names, problems: found } = variablesOf(text);
      problems.push(...found.map((problem) => `${file}: ${problem}`));
      for (const name of names) {
        variables.push({ file, name });
        if (!defined.has(name)) {
          problems.push(`${file}: \${${name}} is not defined`);
        }
      }
    }
  };

  // a step, or the options of a runFlow, retry or repeat: its variables, texts and links
  const useStep = (value, defined, file) => {
    useVariables(value, defined, file);
    for (const text of textSelectorsOf(value)) {
      texts.push({ file, text: substituteVariables(text, defined) });
    }
    for (const link of linksOf(value)) {
      links.push({ file, link: substituteVariables(link, defined) });
    }
  };

  const visitSteps = (steps, defined, file, stack) => {
    for (const step of steps) {
      const run = isRecord(step) ? step[RUN_FLOW] : undefined;
      if (run === undefined) {
        const nested = isRecord(step) ? Object.values(step)[0] : undefined;
        if (isRecord(nested) && Array.isArray(nested[COMMANDS])) {
          // retry, repeat: their commands share the flow's variables
          const { [COMMANDS]: commands, ...options } = nested;
          useStep(options, defined, file);
          visitSteps(commands, defined, file, stack);
        } else {
          useStep(step, defined, file);
        }
        continue;
      }
      const options = isRecord(run) ? run : { file: run };
      const { env = {}, file: target, [COMMANDS]: commands, ...rest } = options;
      useVariables(env, defined, file);
      useStep(rest, defined, file);
      const child = new Map([...defined, ...envScope(env, defined)]);
      if (typeof target === 'string') {
        visitFile(path.resolve(path.dirname(file), target), child, stack);
      }
      if (Array.isArray(commands)) {
        visitSteps(commands, child, file, stack);
      }
    }
  };

  const visitFile = (file, inherited, stack) => {
    if (stack.includes(file)) {
      problems.push(`runFlow cycle: ${[...stack, file].join(' -> ')}`);
      return;
    }
    const text = load(file);
    if (text === null) {
      problems.push(`${stack.at(-1) ?? file}: runFlow file not found: ${file}`);
      return;
    }
    let flow;
    try {
      flow = readFlow(text);
    } catch (error) {
      problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!files.includes(file)) {
      files.push(file);
    }
    selectors.push(...selectorsOf(flow.steps).map((id) => ({ file, id })));
    selectors.push(...selectorsOf(flow.config).map((id) => ({ file, id })));
    const { env = {}, onFlowStart = [], onFlowComplete = [] } = flow.config;
    useVariables(env, inherited, file);
    const defined = new Map([...inherited, ...envScope(env, inherited)]);
    const nextStack = [...stack, file];
    for (const hook of [onFlowStart, onFlowComplete]) {
      if (Array.isArray(hook)) {
        visitSteps(hook, defined, file, nextStack);
      }
    }
    visitSteps(flow.steps, defined, file, nextStack);
  };

  visitFile(entry, new Map(external.map((name) => [name, null])), []);
  return { files, selectors, texts, links, variables, problems };
};
