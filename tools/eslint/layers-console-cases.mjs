// case tables for layers.test.mjs on console use: production files of app/ and src/ never use
// console, except the sentry adapter (src/platform/sentry.ts); test code is exempt (ADR-0012)

import { EXISTING, PROBES } from './layers-harness.mjs';
import { allowed, rejected } from './layers-cases.mjs';

const NO_CONSOLE = 'no-console';
const CONSOLE_MESSAGE = 'Unexpected console statement';

// probes are [label, code] pairs
const CONSOLE_CALLS = [
  ['console.warn()', "export const warn = () => {\n  console.warn('probe');\n};\n"],
  ['console.error()', "export const fail = () => {\n  console.error('probe');\n};\n"],
  ['console.log()', "export const log = () => {\n  console.log('probe');\n};\n"],
];

export const REJECTED = {
  console: rejected(
    [EXISTING.layout, EXISTING.index, PROBES.features, PROBES.ui, PROBES.platform, PROBES.core],
    NO_CONSOLE,
    CONSOLE_MESSAGE,
    CONSOLE_CALLS,
  ),
};

export const ALLOWED = {
  console: allowed(
    [EXISTING.sentry, PROBES.platformTest, PROBES.featuresTest, PROBES.uiTest, PROBES.hooksTest],
    CONSOLE_CALLS,
  ),
};
