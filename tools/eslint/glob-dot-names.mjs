// import-x/no-restricted-paths matches a glob target with minimatch and no dot option: "*", "!(...)"
// and "**" never match a dot name, so a dotfile (.probe.ts) or anything in a dot-folder (.cache/)
// would escape every glob target. withDotNames gives each glob its dot-name variants, where a dot
// name is never one of the names a pattern excludes (CONTRIBUTING.md section 4)

const SEPARATOR = '/';
const GLOBSTAR = '**';
const ANY_NAME = '*';
const DOT_NAME = '.*';
// minimatch cannot repeat a segment pattern, so a globstar crosses at most this many nested
// dot-folders; each extra level multiplies the variants
const DOT_FOLDER_DEPTH = 2;
// a segment that may start with any character: "*", "?", "[...]" or an extglob, e.g. "*.*" or
// "!(jikan)"; a segment starting with a plain character ("_layout.!(tsx)") never matches a dot name
const ANY_START = /^(?:[*?[]|[!@+]\()/;

// the ways a segment may match: a globstar may cross dot-folders, a segment starting with any
// character may be any dot name
const segmentVariants = (segment) => {
  if (segment === GLOBSTAR) {
    return Array.from({ length: DOT_FOLDER_DEPTH + 1 }, (_, depth) =>
      [GLOBSTAR, ...Array.from({ length: depth }, () => `${DOT_NAME}${SEPARATOR}${GLOBSTAR}`)].join(
        SEPARATOR,
      ),
    );
  }
  return ANY_START.test(segment) ? [segment, DOT_NAME] : [segment];
};

// the target itself, then every variant with at least one dot name: each variant keeps a ".*"
// after a separator, so it stays a glob on windows, where the resolved target puts a backslash
// before each segment (see targetsExcept in tools/eslint/layers.mjs). a trailing globstar is read
// as "**/*" (the same files), so a dotfile at its end gets a variant too
const targetVariants = (target) => {
  const segments = target.split(SEPARATOR);
  if (segments.at(-1) === GLOBSTAR) {
    segments.push(ANY_NAME);
  }
  const [, ...variants] = segments
    .map(segmentVariants)
    .reduce((paths, options) =>
      paths.flatMap((prefix) => options.map((option) => `${prefix}${SEPARATOR}${option}`)),
    );
  return [target, ...variants];
};

// a folder target (no glob) already covers the dot names inside it and is kept as is
export const withDotNames = (zone) => {
  const targets = [zone.target].flat().flatMap(targetVariants);
  return { ...zone, target: targets.length === 1 ? zone.target : targets };
};
