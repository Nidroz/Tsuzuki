// tsuzuki/backlog-reference: work markers and ts directives cite an open backlog item
// (CONTRIBUTING.md section 5); the id and a text follow the marker or directive in parentheses

import { readFileSync } from 'node:fs';
import path from 'node:path';

const RULE = 'CONTRIBUTING.md section 5';
const DEFAULT_BACKLOG_FILE = 'docs/BACKLOG.md';

// every uppercase work marker, as a whole word
const MARKER = /\b(?:TODO|FIXME)\b/g;
// what must follow a marker: "(X-00): text"
const MARKER_REFERENCE = /^\(([A-Z]-\d{2})\): \S/;
// ts honours a directive only at the start of a line comment or of the last line of a block
// comment (same detection as @typescript-eslint/ban-ts-comment, which owns the format)
const LINE_DIRECTIVE = /^\/*\s*@ts-(?:expect-error|ignore)\(([A-Z]-\d{2})\)/;
const BLOCK_DIRECTIVE = /^\s*(?:\/|\*)*\s*@ts-(?:expect-error|ignore)\(([A-Z]-\d{2})\)/;
// checkbox lines of the backlog, e.g. "- [x] F-01 Initialize the Expo project"; markdown ticks a
// box with "x" or "X"
const BACKLOG_ITEM = /^- \[( |[xX])\] ([A-Z]-\d{2})\b/gm;

// resolved backlog path -> { items: Map<id, done> } or { error: string }, read once per process
const backlogCache = new Map();

const parseBacklog = (text) => {
  const items = new Map();
  for (const [, box, id] of text.matchAll(BACKLOG_ITEM)) {
    // a duplicated id stays open while any of its lines is unticked
    items.set(id, (items.get(id) ?? true) && box !== ' ');
  }
  return items;
};

const loadBacklog = (file) => {
  const cached = backlogCache.get(file);
  if (cached) {
    return cached;
  }
  let entry;
  try {
    entry = { items: parseBacklog(readFileSync(file, 'utf8')) };
  } catch (error) {
    // the error code (e.g. ENOENT) is stable and path free; the message is the fallback
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    entry = { error: typeof code === 'string' ? code : String(error) };
  }
  backlogCache.set(file, entry);
  return entry;
};

// the text between the comment delimiters starts 2 characters after the comment's start
const DELIMITER_LENGTH = 2;

// backlog ids cited by a comment, with their offset inside comment.value, plus malformed markers
const scanComment = (comment) => {
  const references = [];
  const missing = [];
  for (const match of comment.value.matchAll(MARKER)) {
    const after = comment.value.slice(match.index + match[0].length);
    const reference = MARKER_REFERENCE.exec(after);
    if (reference?.[1]) {
      references.push({ id: reference[1], offset: match.index, length: match[0].length });
    } else {
      missing.push({ marker: match[0], offset: match.index, length: match[0].length });
    }
  }
  const lines = comment.value.split('\n');
  const directiveLine = comment.type === 'Line' ? comment.value : (lines.at(-1) ?? '');
  const directive = (comment.type === 'Line' ? LINE_DIRECTIVE : BLOCK_DIRECTIVE).exec(
    directiveLine,
  );
  if (directive?.[1]) {
    const lineOffset = comment.value.length - directiveLine.length;
    const column = directiveLine.indexOf('@ts-');
    references.push({
      id: directive[1],
      offset: lineOffset + column,
      length: directive[0].length - column,
    });
  }
  return { references, missing };
};

export const backlogReference = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'require TODO/FIXME comments and ts directives to cite an open backlog item from docs/BACKLOG.md',
    },
    schema: [
      {
        type: 'object',
        properties: {
          backlogFile: {
            type: 'string',
            minLength: 1,
            description: 'backlog path, resolved against the eslint cwd',
          },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ backlogFile: DEFAULT_BACKLOG_FILE }],
    messages: {
      missingId: `{{marker}} must cite a backlog id: "{{marker}}(X-00): text", where X-00 is an open item of docs/BACKLOG.md (${RULE}).`,
      unknownId: `{{id}} is not an item of {{backlogFile}}: cite an existing backlog id, or add the item first (${RULE}).`,
      completedId: `{{id}} is ticked in {{backlogFile}}: this reference is stale, finish the work or cite an open item (${RULE}).`,
      backlogUnreadable: `cannot read the backlog {{backlogFile}} to check backlog ids ({{reason}}) (${RULE}).`,
    },
  },
  create(context) {
    const { sourceCode } = context;
    const backlogFile = context.options[0]?.backlogFile ?? DEFAULT_BACKLOG_FILE;
    const backlogPath = path.resolve(context.cwd, backlogFile);

    const locOf = (comment, offset, length) => {
      const start = comment.range[0] + DELIMITER_LENGTH + offset;
      return {
        start: sourceCode.getLocFromIndex(start),
        end: sourceCode.getLocFromIndex(start + length),
      };
    };

    return {
      Program() {
        let unreadableReported = false;
        for (const comment of sourceCode.getAllComments()) {
          if (comment.type !== 'Line' && comment.type !== 'Block') {
            continue;
          }
          const { references, missing } = scanComment(comment);
          for (const { marker, offset, length } of missing) {
            context.report({
              loc: locOf(comment, offset, length),
              messageId: 'missingId',
              data: { marker },
            });
          }
          if (references.length === 0) {
            continue;
          }
          // read lazily: a file that cites no id never needs the backlog
          const backlog = loadBacklog(backlogPath);
          if (backlog.error !== undefined) {
            if (!unreadableReported) {
              unreadableReported = true;
              const [first] = references;
              context.report({
                loc: locOf(comment, first.offset, first.length),
                messageId: 'backlogUnreadable',
                data: { backlogFile, reason: backlog.error },
              });
            }
            continue;
          }
          for (const { id, offset, length } of references) {
            const done = backlog.items.get(id);
            if (done === undefined || done) {
              context.report({
                loc: locOf(comment, offset, length),
                messageId: done === undefined ? 'unknownId' : 'completedId',
                data: { id, backlogFile },
              });
            }
          }
        }
      },
    };
  },
};
