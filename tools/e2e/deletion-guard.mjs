// the account deletion guard of the ci flows (e2e/README.md "Shared test account"): no ci flow, nor
// any subflow it reaches, may select a control of the account deletion by id or by text, or open a
// link reaching its route. the texts come from the translation catalogs, so they cannot drift.
// a static check of the flow files: a tap on a point or a script stays out of its reach

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** the route of the account deletion screen (app/account/delete.tsx), as path segments */
export const DELETION_ROUTE = ['account', 'delete'];
/** the `id:` selectors of the account deletion: the settings button and the deletion screen */
export const DELETION_SELECTOR_PREFIXES = ['delete-account', 'settings-account-delete-account'];
/** the catalog keys of the deletion texts: the settings button and the deletion screen */
export const DELETION_TEXT_KEYS = ['settings.account.deleteAccount', 'settings.deleteAccount'];
/** the controls that lead to a deletion: their texts are kept even when another key shares them */
export const DELETION_CONTROL_KEYS = [
  'settings.account.deleteAccount',
  'settings.deleteAccount.delete',
  'settings.deleteAccount.confirm.confirm',
];

const JSON_EXTENSION = '.json';
// maestro matches a text selector as a whole, ignoring case, `.` matching a line break too
const TEXT_REGEX_FLAGS = 'is';
// a leading inline flag group (`(?i)`), valid for maestro's regex engine and not for javascript
const INLINE_FLAGS = /^\(\?[a-z]+\)/i;
const PERCENT_ESCAPE = /%([0-9a-f]{2})/gi;
// the url parser drops tabs and line breaks anywhere in a link
const URL_IGNORED = /[\t\n\r]/g;
// a link is read as parts (the path, each query name and value, the fragment), each as segments
const PART_SEPARATORS = /[?#&=]/;
const SEGMENT_SEPARATORS = /[/\\:]/;
const PARENT_SEGMENT = '..';
const IGNORED_SEGMENT = /^(?:\.|\(.*\))?$/;

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// every string of a catalog with its dotted key
const keyedStrings = (value, prefix) => {
  if (typeof value === 'string') {
    return [[prefix, value]];
  }
  return isRecord(value)
    ? Object.entries(value).flatMap(([key, child]) =>
        keyedStrings(child, prefix === '' ? key : `${prefix}.${key}`),
      )
    : [];
};

const isDeletionKey = (key) =>
  DELETION_TEXT_KEYS.some((root) => key === root || key.startsWith(`${root}.`));

/**
 * the texts of the account deletion in `catalogs` (parsed translation files), sorted: every text
 * under DELETION_TEXT_KEYS, except one another key of the same catalog shares (ignoring case, as
 * maestro does: "Cancel", "Sign in"), unless it is the text of a DELETION_CONTROL_KEYS control
 */
export const deletionTextsOf = (catalogs) => {
  const texts = new Set();
  for (const catalog of catalogs) {
    const entries = keyedStrings(catalog, '');
    const shared = new Set(
      entries.filter(([key]) => !isDeletionKey(key)).map(([, text]) => text.toLowerCase()),
    );
    for (const [key, text] of entries) {
      const kept = DELETION_CONTROL_KEYS.includes(key) || !shared.has(text.toLowerCase());
      if (isDeletionKey(key) && kept) {
        texts.add(text);
      }
    }
  }
  return [...texts].sort();
};

/** deletionTextsOf the translation files (`*.json`) of `directory` */
export const readDeletionTexts = (directory) =>
  deletionTextsOf(
    readdirSync(directory)
      .filter((name) => name.endsWith(JSON_EXTENSION))
      .sort()
      .map((name) => JSON.parse(readFileSync(path.join(directory, name), 'utf8'))),
  );

// percent escapes decoded until none is left: each round shortens the text, so it ends
const decoded = (text) => {
  const next = text.replace(PERCENT_ESCAPE, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  return next === text ? text : decoded(next);
};

// the segments of a part of a link, lowercase, without empty, `.` and group segments; `..` drops
// the previous segment when `resolve` is set
const segmentsOf = (part, resolve) => {
  const segments = [];
  for (const raw of part.split(SEGMENT_SEPARATORS)) {
    const segment = raw.trim().toLowerCase();
    if (IGNORED_SEGMENT.test(segment)) {
      continue;
    }
    if (resolve && segment === PARENT_SEGMENT) {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments;
};

const holdsRoute = (segments) =>
  segments.some((_, index) =>
    DELETION_ROUTE.every((part, offset) => segments[index + offset] === part),
  );

/**
 * whether `link` (an openLink target, its variables substituted) may open the account deletion:
 * a part of it, percent escapes decoded, holds the route segments in a row, with or without its
 * `..` segments applied, whatever the scheme, the host, the slashes, the case, a query or a
 * fragment. a part covers a link nested in a query value (the dev-client `url`, which expo-router
 * opens)
 */
export const linkReachesDeletion = (link) =>
  decoded(link.replace(URL_IGNORED, ''))
    .split(PART_SEPARATORS)
    .some((part) => holdsRoute(segmentsOf(part, false)) || holdsRoute(segmentsOf(part, true)));

/**
 * the first of `texts` the maestro text selector `selector` matches (as a literal ignoring case,
 * or as a regex matching the whole text), else null. throws for a selector javascript cannot read
 * as a regex: it cannot be checked
 */
export const deletionTextMatch = (selector, texts) => {
  const literal = selector.toLowerCase();
  let regex;
  try {
    regex = new RegExp(`^(?:${selector.replace(INLINE_FLAGS, '')})$`, TEXT_REGEX_FLAGS);
  } catch {
    throw new Error(`the text selector ${selector} cannot be checked against the deletion texts`);
  }
  return texts.find((text) => text.toLowerCase() === literal || regex.test(text)) ?? null;
};

const relativeTo = (root, file) =>
  root === null ? file : path.relative(root, file).split(path.sep).join('/');

/**
 * the problems of a ci flow analysis (analyzeFlow): an `id:` selector starting with a
 * DELETION_SELECTOR_PREFIXES prefix, a link reaching the deletion route, a text selector matching
 * one of `texts` (readDeletionTexts) or that cannot be checked. files relative to `root` when set
 */
export const deletionProblemsOf = ({ selectors, links, texts: selected }, texts, root = null) => {
  const problems = [];
  for (const { file, id } of selectors) {
    if (DELETION_SELECTOR_PREFIXES.some((prefix) => id.startsWith(prefix))) {
      problems.push(`${relativeTo(root, file)}: selects the deletion id ${id}`);
    }
  }
  for (const { file, link } of links) {
    if (linkReachesDeletion(link)) {
      problems.push(`${relativeTo(root, file)}: opens the deletion route with ${link}`);
    }
  }
  for (const { file, text } of selected) {
    try {
      const match = deletionTextMatch(text, texts);
      if (match !== null) {
        problems.push(
          `${relativeTo(root, file)}: selects the deletion text "${match}" with ${text}`,
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      problems.push(`${relativeTo(root, file)}: ${reason}`);
    }
  }
  return problems;
};
