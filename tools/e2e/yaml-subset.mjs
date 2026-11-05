// a reader for the yaml subset the maestro flows use (e2e/**/*.yaml): documents split by `---`,
// block mappings and block sequences by indentation (spaces only), plain and quoted scalars, full
// line and trailing comments. anything else (flow collections, anchors, tags, block scalars, tabs)
// throws with its line number, so a flow never silently reads as something else

const DOCUMENT_SEPARATOR = '---';
const SEQUENCE_DASH = '-';
const KEY_PATTERN = /^([A-Za-z_][\w-]*):(?:[ ]+(.*))?$/;
const INTEGER_PATTERN = /^-?\d+$/;
// first characters of yaml syntax outside the subset
const UNSUPPORTED_STARTS = new Set(['{', '[', '&', '*', '!', '|', '>', '%', '@', '`']);
const SCALAR_WORDS = new Map([
  ['true', true],
  ['false', false],
  ['null', null],
  ['~', null],
]);

export class YamlSubsetError extends Error {
  constructor(message, lineNumber) {
    super(lineNumber === undefined ? message : `line ${String(lineNumber)}: ${message}`);
    this.name = 'YamlSubsetError';
  }
}

const isSequenceItem = (text) => text === SEQUENCE_DASH || text.startsWith(`${SEQUENCE_DASH} `);

// a quote opens a quoted scalar only where a scalar starts: the start of the content, after `: `
// or after `- `. a quote inside a plain scalar (an expression such as ${f('x')}) is plain text
const opensQuote = (content, index) =>
  index === 0 || content.endsWith(': ', index) || content.endsWith('- ', index);

// the content of a line without its comment: `#` at the start or after a space, outside quotes
const stripComment = (content, lineNumber) => {
  let quote = null;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quote !== null) {
      if (quote === '"' && char === '\\') {
        index += 1;
      } else if (char === quote) {
        if (quote === "'" && content[index + 1] === "'") {
          index += 1;
        } else {
          quote = null;
        }
      }
    } else if ((char === "'" || char === '"') && opensQuote(content, index)) {
      quote = char;
    } else if (char === '#' && (index === 0 || content[index - 1] === ' ')) {
      return content.slice(0, index).trimEnd();
    }
  }
  if (quote !== null) {
    throw new YamlSubsetError('unterminated quoted scalar', lineNumber);
  }
  return content.trimEnd();
};

const parseScalar = (text, lineNumber) => {
  if (text.startsWith("'")) {
    if (text.length < 2 || !text.endsWith("'")) {
      throw new YamlSubsetError('a single-quoted scalar must end the line', lineNumber);
    }
    return text.slice(1, -1).replaceAll("''", "'");
  }
  if (text.startsWith('"')) {
    try {
      return String(JSON.parse(text));
    } catch {
      throw new YamlSubsetError('invalid double-quoted scalar', lineNumber);
    }
  }
  if (UNSUPPORTED_STARTS.has(text.charAt(0))) {
    throw new YamlSubsetError(`unsupported yaml syntax: ${text}`, lineNumber);
  }
  if (SCALAR_WORDS.has(text)) {
    return SCALAR_WORDS.get(text);
  }
  return INTEGER_PATTERN.test(text) ? Number(text) : text;
};

// a node at `indent` starting at lines[position]: [value, next position]
const parseNode = (lines, position, indent) =>
  isSequenceItem(lines[position].text)
    ? parseSequence(lines, position, indent)
    : parseMapping(lines, position, indent);

// the value of a key or an item whose text ended the line: the indented block below, if any.
// a sequence may sit at the same indent as its key
const parseNested = (lines, position, indent, allowSameIndentSequence) => {
  const next = lines[position + 1];
  const nests =
    next !== undefined &&
    (next.indent > indent ||
      (allowSameIndentSequence && next.indent === indent && isSequenceItem(next.text)));
  return nests ? parseNode(lines, position + 1, next.indent) : [null, position + 1];
};

const rejectDeeperLine = (lines, position, indent) => {
  const line = lines[position];
  if (line !== undefined && line.indent > indent) {
    throw new YamlSubsetError('unexpected indentation', line.number);
  }
};

const parseSequence = (lines, start, indent) => {
  const items = [];
  let position = start;
  while (position < lines.length) {
    const line = lines[position];
    if (line.indent !== indent || !isSequenceItem(line.text)) {
      break;
    }
    const rest = line.text.slice(SEQUENCE_DASH.length).trimStart();
    let value;
    if (rest === '') {
      [value, position] = parseNested(lines, position, indent, false);
    } else if (KEY_PATTERN.test(rest) || isSequenceItem(rest)) {
      // the item's content continues as a block at the column where it starts
      const restIndent = indent + line.text.length - rest.length;
      lines[position] = { ...line, indent: restIndent, text: rest };
      [value, position] = parseNode(lines, position, restIndent);
    } else {
      value = parseScalar(rest, line.number);
      position += 1;
    }
    items.push(value);
  }
  rejectDeeperLine(lines, position, indent);
  return [items, position];
};

const parseMapping = (lines, start, indent) => {
  const mapping = {};
  let position = start;
  while (position < lines.length) {
    const line = lines[position];
    if (line.indent !== indent || isSequenceItem(line.text)) {
      break;
    }
    const match = KEY_PATTERN.exec(line.text);
    if (match === null) {
      throw new YamlSubsetError(`expected "key: value", got: ${line.text}`, line.number);
    }
    const [, key, rest = ''] = match;
    if (Object.hasOwn(mapping, key)) {
      throw new YamlSubsetError(`duplicate key: ${key}`, line.number);
    }
    let value;
    if (rest === '') {
      [value, position] = parseNested(lines, position, indent, true);
    } else {
      value = parseScalar(rest, line.number);
      position += 1;
    }
    mapping[key] = value;
  }
  rejectDeeperLine(lines, position, indent);
  return [mapping, position];
};

const parseDocument = (lines) => {
  if (lines.length === 0) {
    return null;
  }
  const [first] = lines;
  if (first.indent !== 0) {
    throw new YamlSubsetError('a document starts at column 0', first.number);
  }
  const [value, position] = parseNode(lines, 0, 0);
  if (position < lines.length) {
    throw new YamlSubsetError('unexpected content', lines[position].number);
  }
  return value;
};

/** reads `text` as the yaml subset: one value per document, in order */
export const readYamlSubset = (text) => {
  const documents = [[]];
  text.split(/\r?\n/).forEach((raw, index) => {
    const number = index + 1;
    if (/^\s*\t/.test(raw)) {
      throw new YamlSubsetError('tabs are not allowed in indentation', number);
    }
    if (raw.trimEnd() === DOCUMENT_SEPARATOR) {
      documents.push([]);
      return;
    }
    const indent = raw.length - raw.trimStart().length;
    const content = stripComment(raw.trimStart(), number);
    if (content !== '') {
      documents.at(-1).push({ number, indent, text: content });
    }
  });
  return documents.map(parseDocument);
};
