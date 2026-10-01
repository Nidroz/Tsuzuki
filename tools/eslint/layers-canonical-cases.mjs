// case tables for layers.test.mjs on canonical paths, "." and empty segments: a "." segment after
// the first one, a "//" or a trailing "/" leave the module unchanged but hide it from the rules that
// read the specifier text (barrels, package bans), so the canonical path rule rejects them. a
// leading "./", a bare ".", "..", and leading "../" segments stay the canonical relative forms
// (CONTRIBUTING.md section 4)

import { EXISTING, PROBES } from './layers-harness.mjs';
import { IMPORTS, MESSAGES, SYNTAX, allowed, dynamics, rejected, values } from './layers-cases.mjs';
import { jestCall } from './layers-test-code-cases.mjs';

const GROUP = 'canonical paths: no "." or empty segment';

export const REJECTED = {
  [GROUP]: [
    ...rejected(PROBES.features, IMPORTS, MESSAGES.canonical, values('@core/./i18n/index')),
    ...rejected(EXISTING.layout, IMPORTS, MESSAGES.canonical, values('@core//i18n/index')),
    // a trailing "/" is an empty last segment
    ...rejected(PROBES.featuresTest, IMPORTS, MESSAGES.canonical, values('@ui/index/')),
    ...rejected(PROBES.core, IMPORTS, MESSAGES.canonical, values('./x/./y')),
    ...rejected(PROBES.hooks, IMPORTS, MESSAGES.canonical, values('../domain/.')),
    // runtime forms go through no-restricted-syntax
    ...rejected(PROBES.features, SYNTAX, MESSAGES.canonical, dynamics('@core/./i18n/index')),
    ...rejected(PROBES.hooksTest, SYNTAX, MESSAGES.canonical, [
      jestCall('mock', '@core//domain/x'),
    ]),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  [GROUP]: [
    ...allowed(PROBES.features, [
      ...values('@core/i18n/index', './x', '.', '../features/x'),
      ...dynamics('@core/i18n/index'),
    ]),
    ...allowed(EXISTING.layout, values('@core/i18n/index')),
    ...allowed(PROBES.featuresTest, values('@ui/index')),
    ...allowed(PROBES.core, values('./x/y', '.')),
    ...allowed(PROBES.hooks, values('../domain/x', '..', '../../core/domain/x')),
    ...allowed(PROBES.hooksTest, [jestCall('mock', '@core/domain/x')]),
  ],
};
