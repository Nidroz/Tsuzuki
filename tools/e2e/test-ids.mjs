// checks a maestro `id:` selector against the testIDs the app source can produce
// (test-id-sources.mjs). a selector matches a candidate when some value of the candidate's
// wildcards gives it, a wildcard after the start standing for one dash-free segment (a kind, a
// status, a catalog id). a candidate that starts with a wildcard (`${testID}-error` in a
// primitive) only matches when the part of the selector standing for that wildcard matches too:
// - a generic candidate (no letter or digit in its literals, `${prefix}-${kind}-${id}`) follows
//   its prop: that part must be a value the callers of its component pass to that prop;
// - any other one: that part must match a candidate (recursively).
// so `.*-error` never matches every `-error` id, and `${testID}-${value}` never appends a segment
// to any known id

import { WILDCARD } from './test-id-sources.mjs';
import { selectorSamples } from './selector-samples.mjs';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

const partsPattern = (parts) =>
  new RegExp(
    `^${parts.map((part) => (part === WILDCARD ? '[^-]+' : escapeRegExp(part))).join('')}$`,
    'u',
  );

const isGeneric = (parts) =>
  parts.every((part) => part === WILDCARD || !/[\p{L}\p{N}]/u.test(part));

// a candidate compiled for matching
const compile = ({ parts, lead, owner }) => {
  if (parts.length === 0 || parts.every((part) => part === WILDCARD)) {
    return null;
  }
  if (parts.length === 1) {
    return { kind: 'literal', literal: parts[0] };
  }
  if (parts[0] !== WILDCARD) {
    return { kind: 'pattern', pattern: partsPattern(parts) };
  }
  const rest = parts.slice(1);
  return {
    kind: 'prefixed',
    first: rest[0],
    rest: partsPattern(rest),
    generic: isGeneric(rest),
    lead,
    owner,
  };
};

const memoized = (compute) => {
  const memo = new Map();
  return (key, ...args) => {
    if (memo.has(key)) {
      return memo.get(key);
    }
    // no endless recursion: a cycle reads false
    memo.set(key, false);
    const result = compute(...args);
    memo.set(key, result);
    return result;
  };
};

/**
 * a matcher over the output of collectTestIds: `matches(id)` is true when the source can produce
 * the concrete `id`
 */
export const createIdMatcher = ({ candidates, attributes, aliases }) => {
  const compiled = candidates.map(compile).filter((candidate) => candidate !== null);
  const literals = new Set(
    compiled.filter(({ kind }) => kind === 'literal').map(({ literal }) => literal),
  );
  const patterns = compiled.filter(({ kind }) => kind === 'pattern');
  const prefixed = compiled.filter(({ kind }) => kind === 'prefixed');
  const componentOf = new Map(aliases);
  const passed = new Map();
  for (const { component, prop, value } of attributes) {
    const key = `${componentOf.get(component) ?? component}.${prop}`;
    const compiledValue = value.forward === undefined ? compile(value) : value;
    if (compiledValue !== null) {
      passed.set(key, [...(passed.get(key) ?? []), compiledValue]);
    }
  }

  // the part before `first` in `id` for each split whose rest matches
  const prefixesOf = (id, { first, rest }) => {
    const found = [];
    for (let index = id.indexOf(first, 1); index > 0; index = id.indexOf(first, index + 1)) {
      if (rest.test(id.slice(index))) {
        found.push(id.slice(0, index));
      }
    }
    return found;
  };

  const matchesCompiled = (candidate, id, bound) => {
    if (candidate.kind === 'literal') {
      return candidate.literal === id;
    }
    if (candidate.kind === 'pattern') {
      return candidate.pattern.test(id);
    }
    const followsProp = candidate.lead !== null && candidate.owner !== null;
    if (candidate.generic && !followsProp) {
      return false;
    }
    return prefixesOf(id, candidate).some((prefix) =>
      (candidate.generic || bound) && followsProp
        ? matchesProp(`${candidate.owner}.${candidate.lead}:${prefix}`, candidate, prefix)
        : matches(prefix),
    );
  };

  // whether a value the callers of the candidate's component pass to its prop gives `id`
  const matchesProp = memoized(({ owner, lead }, id) =>
    (passed.get(`${owner}.${lead}`) ?? []).some((value) =>
      value.forward === undefined
        ? matchesCompiled(value, id, true)
        : value.forward.component !== null &&
          matchesProp(
            `${value.forward.component}.${value.forward.prop}:${id}`,
            { owner: value.forward.component, lead: value.forward.prop },
            id,
          ),
    ),
  );

  const matchesId = memoized(
    (id) =>
      literals.has(id) ||
      patterns.some(({ pattern }) => pattern.test(id)) ||
      prefixed.some((candidate) => matchesCompiled(candidate, id, false)),
  );
  const matches = (id) => matchesId(id, id);
  return { matches };
};

/** whether the maestro `id:` selector (a literal or a regex) matches an id the source produces */
export const selectorMatches = (matcher, selector) =>
  selectorSamples(selector).some((sample) => matcher.matches(sample));
