// single source of truth for commit messages: conventional commits plus the single-author policy
// (CONTRIBUTING.md section 2). the commit-msg hook and CI both run commitlint with this file.

const POLICY = 'CONTRIBUTING.md section 2';
const SCISSORS_LINE = /^# -* >8 -*$/;
const COMMENT_LINE = /^#/;

const VIOLATIONS = [
  { pattern: /^\s*co-authored-by:/i, reason: 'co-author trailers are not allowed' },
  {
    pattern: /^[^\p{L}\p{N}]*generated[ -](?:with|by)(?:[\s:]|$)/iu,
    reason: 'tool-generated footers are not allowed',
  },
];

// headers written by git or the hosting platform, never typed by hand
const GIT_GENERATED_HEADERS = [
  /^Merge (?:branch|remote-tracking branch|pull request|tag) /,
  /^Merge [0-9a-f]{7,40}/,
  /^Revert "/,
  /^(?:fixup|squash|amend)! /,
];

// the lines git keeps: everything from the scissors line onwards is dropped, then comment lines.
// done here on purpose, never delegated to commitlint's own comment handling (only active with --edit)
const messageLines = (message) => {
  const lines = message.split(/\r?\n/);
  const scissors = lines.findIndex((line) => SCISSORS_LINE.test(line));
  const kept = scissors === -1 ? lines : lines.slice(0, scissors);
  return kept.filter((line) => !COMMENT_LINE.test(line));
};

// returns the policy violation found in a raw commit message, or null when it complies
export const singleAuthorViolation = (message) => {
  const lines = messageLines(message);
  const violation = VIOLATIONS.find(({ pattern }) => lines.some((line) => pattern.test(line)));
  return violation ? `${violation.reason} (see ${POLICY})` : null;
};

const rawMessage = (parsed) =>
  typeof parsed.raw === 'string'
    ? parsed.raw
    : [parsed.header, parsed.body, parsed.footer]
        .filter((part) => typeof part === 'string')
        .join('\n\n');

// commitlint rule; any condition other than "always" fails closed instead of inverting the policy
export const singleAuthor = (parsed, when = 'always') => {
  if (when !== 'always') {
    return [false, `single-author only supports the "always" condition (see ${POLICY})`];
  }
  const violation = singleAuthorViolation(rawMessage(parsed));
  return [violation === null, violation ?? ''];
};

const isGitGenerated = (message) => {
  const header = messageLines(message).find((line) => line.trim() !== '') ?? '';
  return GIT_GENERATED_HEADERS.some((pattern) => pattern.test(header));
};

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [{ rules: { 'single-author': singleAuthor } }],
  rules: { 'single-author': [2, 'always'] },
  // commitlint's default ignores skip every rule, single-author included. git-generated commits are
  // exempt from the conventional rules only, and only while they comply with the single-author policy
  defaultIgnores: false,
  ignores: [(message) => isGitGenerated(message) && singleAuthorViolation(message) === null],
};
