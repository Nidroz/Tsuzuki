// lets app.config.ts import the core app env schema (src/core/schemas/app-env.ts, ADR-0012): the
// expo cli compiles the app config file itself, but its imports go through plain node, which
// strips typescript types natively (node >= 22.18) and resolves no extensionless ".ts" import. this
// resolve hook retries a failed relative import from a typescript file with the ".ts" extension.
// loaded for its side effect, first, by app.config.ts; node caches it, so the hook is registered
// once per process
const { registerHooks } = require('node:module');

const RELATIVE_SPECIFIER = /^\.{1,2}\//;
const TYPESCRIPT_FILE = /\.(?:ts|cts|mts)$/;
const APP_CONFIG_FILE = /\/app\.config\.(?:js|ts)$/;
const TS_EXTENSION = '.ts';
const TS_MODULE_FORMAT = 'module-typescript';

// the importing file (a file url): a typescript module, or the compiled app config (named
// app.config.js)
const importsTypeScript = (parentURL) =>
  parentURL !== undefined && (TYPESCRIPT_FILE.test(parentURL) || APP_CONFIG_FILE.test(parentURL));

// the repository's typescript is written as es modules: saying so up front spares node a failed
// commonjs parse and its MODULE_TYPELESS_PACKAGE_JSON warning
const asTypeScriptModule = (resolved) =>
  resolved.url.endsWith(TS_EXTENSION) ? { ...resolved, format: TS_MODULE_FORMAT } : resolved;

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return asTypeScriptModule(nextResolve(specifier, context));
    } catch (error) {
      if (!RELATIVE_SPECIFIER.test(specifier) || !importsTypeScript(context.parentURL)) {
        throw error;
      }
      return asTypeScriptModule(nextResolve(`${specifier}${TS_EXTENSION}`, context));
    }
  },
});
