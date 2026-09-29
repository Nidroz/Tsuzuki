// tsuzuki/file-name-case: kebab-case folders and files, PascalCase components, expo-router names
// inside app/ (CONTRIBUTING.md section 5). outside app/, dotfiles and dot-folders are kebab-case
// after their single leading dot; inside app/ every file is a route, so none is allowed there, and
// expo-router API routes (+api) get their own message: server logic lives in Supabase Edge Functions

import path from 'node:path';

const RULE = 'CONTRIBUTING.md section 5';
const LAYERS_RULE = 'CONTRIBUTING.md section 4';
const TESTING_RULE = 'CONTRIBUTING.md section 6';
const APP_DIR = 'app';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;
const CAMEL = /^[a-z][A-Za-z0-9]*$/;
const TOOLING_DIRS = new Set(['__tests__', '__fixtures__', '__mocks__']);
// expo-router: layouts and special routes
const APP_SPECIAL_FILES = new Set(['_layout', '+not-found', '+html', '+native-intent']);
// expo-router API routes: "+api" right before the extension ("users+api.ts", "[id]+api.ts")
const API_ROUTE = /\+api(?:\.|$)/;
const DOT = '.';
// the component extension: PascalCase files are components, outside app/ only
const COMPONENT_EXTENSION = 'tsx';
const TEST_SUFFIXES = new Set(['test', 'spec']);

// the file name base: a catch-all "[...param]" keeps its dots, anything else ends at the first dot
const BASE = /^(\[\.\.\.[^\]]*\]|[^.]*)/;

const isParam = (name) => CAMEL.test(name) || KEBAB.test(name);

// "[param]" and "[...param]"
const isDynamicSegment = (segment) => {
  const match = /^\[(?:\.\.\.)?([^\]]*)\]$/.exec(segment);
  return match?.[1] !== undefined && isParam(match[1]);
};

// "(group)"
const isGroupSegment = (segment) => {
  const match = /^\(([^)]*)\)$/.exec(segment);
  return match?.[1] !== undefined && KEBAB.test(match[1]);
};

// ".name" with a kebab-case name: a single leading dot, so "..x" and "..." stay rejected
const isDotName = (segment) => segment.startsWith(DOT) && KEBAB.test(segment.slice(DOT.length));

const isValidFolder = (segment, inApp) =>
  KEBAB.test(segment) ||
  // dot-folders (.github, .storybook) hold tooling; under app/ they would hold routes
  (!inApp && isDotName(segment)) ||
  // expo-router bundles every file under app/ as a route, so tooling folders are rejected there
  (!inApp && TOOLING_DIRS.has(segment)) ||
  (inApp && (isGroupSegment(segment) || isDynamicSegment(segment)));

// null when the base is not followed by a dot or the end of the name: a catch-all base ends at
// its "]", so "[...slug]-x.tsx" and "[...slug]xy.tsx" have text glued to it
const splitFileName = (name) => {
  const base = BASE.exec(name)?.[1] ?? '';
  const rest = name.slice(base.length);
  if (rest !== '' && !rest.startsWith(DOT)) {
    return null;
  }
  // "" when there is no suffix at all; otherwise the text after the dot, split on dots
  const suffixes = rest === '' ? [] : rest.slice(DOT.length).split(DOT);
  return { base, suffixes };
};

const isValidBase = (base, extension, inApp) => {
  if (KEBAB.test(base)) {
    return true;
  }
  if (inApp) {
    return APP_SPECIAL_FILES.has(base) || isDynamicSegment(base);
  }
  return extension === COMPONENT_EXTENSION && PASCAL.test(base);
};

// posix path segments relative to cwd, or null for a file outside cwd (or a virtual "<input>")
const relativeSegments = (cwd, filename) => {
  if (!path.isAbsolute(filename)) {
    return null;
  }
  const relative = path.relative(cwd, filename);
  if (relative === '' || path.isAbsolute(relative) || relative.split(/[\\/]/)[0] === '..') {
    return null;
  }
  return relative.split(/[\\/]/);
};

export const fileNameCase = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'require kebab-case folders and files, PascalCase components and expo-router names in app/',
    },
    schema: [],
    messages: {
      invalidSegment: `folder "{{segment}}" is not kebab-case; app/ also allows expo-router groups "(name)" and dynamic segments "[param]" / "[...param]" (${RULE}).`,
      invalidFileName: `file name "{{segment}}" breaks the naming rule: kebab-case base, PascalCase only for components (.tsx outside app/), expo-router names (index, _layout, +not-found, [param], ...) inside app/, lowercase kebab suffixes and extension (${RULE}).`,
      testInApp: `"{{segment}}" is a test inside app/: every file in app/ is a route, route tests live in test/app/ (${TESTING_RULE}).`,
      apiRoute: `"{{segment}}" is an API route; expo-router API routes (+api) are not used: server logic lives in Supabase Edge Functions, under supabase/ (${LAYERS_RULE}).`,
    },
  },
  create(context) {
    return {
      Program(node) {
        const segments = relativeSegments(context.cwd, context.filename);
        if (!segments) {
          return;
        }
        const folders = segments.slice(0, -1);
        const name = segments.at(-1) ?? '';
        const inApp = segments.length > 1 && segments[0] === APP_DIR;
        // the report goes on line 1 even when the program starts after leading comments
        const report = (messageId, segment) =>
          context.report({
            node,
            loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
            messageId,
            data: { segment },
          });

        for (const folder of folders) {
          if (!isValidFolder(folder, inApp)) {
            report('invalidSegment', folder);
          }
        }

        // a dotfile outside app/ (.prettierrc.mjs) is checked without its leading dot, with a
        // kebab-case base only; inside app/ the empty base before the dot is rejected
        const isDotFile = !inApp && name.startsWith(DOT);
        const split = splitFileName(isDotFile ? name.slice(DOT.length) : name);
        const { base, suffixes } = split ?? { base: '', suffixes: [] };
        const extension = suffixes.at(-1);
        const validSuffixes = suffixes.every((suffix) => KEBAB.test(suffix));
        const validBase = isDotFile ? KEBAB.test(base) : isValidBase(base, extension, inApp);
        if (inApp && API_ROUTE.test(name)) {
          // the dedicated message replaces the generic one
          report('apiRoute', name);
        } else if (!split || !validSuffixes || !validBase) {
          report('invalidFileName', name);
        }
        if (inApp && suffixes.slice(0, -1).some((suffix) => TEST_SUFFIXES.has(suffix))) {
          report('testInApp', name);
        }
      },
    };
  },
};
