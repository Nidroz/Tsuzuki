// lets app.config.ts import the core app env schema (src/core/schemas/app-env.ts, ADR-0012): the
// expo cli compiles the app config file itself, but its imports go through plain node, which
// strips typescript types natively (node >= 22.18) and resolves no extensionless ".ts" import. this
// resolve hook retries a relative import from a typescript file that was not found with the ".ts"
// extension. loaded for its side effect, first, by app.config.ts; node caches it, so the hook is
// registered once per process
const { registerHooks } = require('node:module');

const RELATIVE_SPECIFIER = /^\.{1,2}\//;
const TYPESCRIPT_FILE = /\.(?:ts|cts|mts)$/;
const APP_CONFIG_FILE = /\/app\.config\.(?:js|ts)$/;
const TS_EXTENSION = '.ts';
const TS_MODULE_FORMAT = 'module-typescript';
// the only failure the ".ts" retry can fix: a module not found, as import (ERR_MODULE_NOT_FOUND)
// and require (MODULE_NOT_FOUND) report it
const MODULE_NOT_FOUND_CODES = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND']);

// the typescript files reached from the app config (named app.config.js once compiled), directly
// or through other files of this set: the repository's typescript they belong to is written as es
// modules. other typescript resolved in the process (tools, dependencies) keeps node's own format
const appConfigGraph = new Set();

const isAppConfigImport = (parentURL) =>
  parentURL !== undefined && (APP_CONFIG_FILE.test(parentURL) || appConfigGraph.has(parentURL));

// the importing file (a file url): a typescript module, or the compiled app config
const importsTypeScript = (parentURL) =>
  parentURL !== undefined && (TYPESCRIPT_FILE.test(parentURL) || APP_CONFIG_FILE.test(parentURL));

// saying the format up front spares node a failed commonjs parse and its
// MODULE_TYPELESS_PACKAGE_JSON warning; only for the app config's graph
const withFormat = (resolved, parentURL) => {
  if (!resolved.url.endsWith(TS_EXTENSION) || !isAppConfigImport(parentURL)) {
    return resolved;
  }
  appConfigGraph.add(resolved.url);
  return { ...resolved, format: TS_MODULE_FORMAT };
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return withFormat(nextResolve(specifier, context), context.parentURL);
    } catch (error) {
      if (
        !MODULE_NOT_FOUND_CODES.has(error?.code) ||
        !RELATIVE_SPECIFIER.test(specifier) ||
        !importsTypeScript(context.parentURL)
      ) {
        throw error;
      }
      let retried;
      try {
        retried = nextResolve(`${specifier}${TS_EXTENSION}`, context);
      } catch {
        // the ".ts" file does not exist either: the original error names what was imported
        throw error;
      }
      return withFormat(retried, context.parentURL);
    }
  },
});
