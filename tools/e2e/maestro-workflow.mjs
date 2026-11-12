// the step of the e2e workflow (.github/workflows/e2e.yml) that runs the flows, read as text: its
// `maestro test` command and its env. the workflow is not read as yaml: its scripts and expressions
// are outside the yaml subset (yaml-subset.mjs)

const MAESTRO_TEST = 'maestro test ';
const ENV_OPTION = '-e';
const FALLBACK = '||';
const STEP_START = /^\s*- name: /;
const ENV_KEY = 'env:';
const ENTRY = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/;
// a mapping nested in a step item (`- name:`) is indented two spaces past its dash
const STEP_KEY_INDENT = 2;

const linesOf = (workflowText) => workflowText.split(/\r?\n/);

const indentOf = (line) => line.length - line.trimStart().length;

// the index of the workflow's only `maestro test` line
const commandIndex = (lines) => {
  const indices = lines.flatMap((line, index) =>
    line.trim().startsWith(MAESTRO_TEST) ? [index] : [],
  );
  if (indices.length !== 1) {
    throw new Error(`expected one "maestro test" line, found ${String(indices.length)}`);
  }
  return indices[0];
};

/**
 * the `maestro test` command of a workflow: the line itself, trimmed, the names passed with
 * `-e NAME=value`, in order, and the targets (the other arguments), up to a `||` fallback command.
 * throws unless the workflow has exactly one such line
 */
export const readMaestroTestLine = (workflowText) => {
  const lines = linesOf(workflowText);
  const command = lines[commandIndex(lines)].trim();
  const words = command.split(/\s+/);
  const fallback = words.indexOf(FALLBACK);
  const tokens = words.slice(2, fallback === -1 ? undefined : fallback);
  const names = [];
  const targets = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === ENV_OPTION) {
      const assignment = tokens[index + 1] ?? '';
      names.push(assignment.slice(0, assignment.indexOf('=')));
      index += 1;
    } else if (token.startsWith('-')) {
      throw new Error(`unexpected maestro option: ${token}`);
    } else {
      targets.push(token);
    }
  }
  return { command, names, targets };
};

/**
 * the env of the workflow step holding the `maestro test` line: each `NAME: value` entry of its
 * `env:` mapping, the value as written. throws when that step has none
 */
export const readMaestroStepEnv = (workflowText) => {
  const lines = linesOf(workflowText);
  const start = lines.slice(0, commandIndex(lines)).findLastIndex((line) => STEP_START.test(line));
  if (start === -1) {
    throw new Error('the "maestro test" line is in no step');
  }
  const keyIndent = indentOf(lines[start]) + STEP_KEY_INDENT;
  const env = {};
  let inEnv = false;
  let found = false;
  for (const line of lines.slice(start + 1)) {
    const text = line.trim();
    const indent = indentOf(line);
    if (text === '' || (inEnv && indent > keyIndent)) {
      const entry = inEnv ? ENTRY.exec(text) : null;
      if (entry !== null) {
        env[entry[1]] = entry[2];
      }
      continue;
    }
    if (indent < keyIndent) {
      // the next step, or a comment before it
      break;
    }
    inEnv = indent === keyIndent && text === ENV_KEY;
    found ||= inEnv;
  }
  if (!found) {
    throw new Error('the "maestro test" step has no env');
  }
  return env;
};
