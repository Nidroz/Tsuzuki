// case tables for layers.test.mjs on hard-coded user-facing text: routes (app/) and features
// (src/features/) show text through t('key') from @core/i18n, never as a literal in JSX, a text prop,
// navigation options or an alert (CONTRIBUTING.md section 5)

import { EXISTING, PROBES } from './layers-harness.mjs';
import { MESSAGES, SYNTAX, allowed, rejected } from './layers-cases.mjs';
import {
  BEYOND_LIMITS,
  COMPONENT_TEXT,
  MODULE_TEXT,
  NO_TEXT,
  SAMPLE_MODULE_TEXT,
  SAMPLE_NO_TEXT,
  SAMPLE_TEXT,
  STORED_TEXT,
} from './layers-text-probes.mjs';

// the guards are one config entry for the production files of app/ and src/features/, so which
// literal is text does not depend on the file: every probe on one route and one feature component,
// every probe that is no text on one file, one probe of each kind on the other production files,
// and one probe on the existing routes, linted with their project (the slowest to lint)
const FULL_COMPONENTS = [PROBES.notFound, PROBES.featuresComponent];
const SAMPLE_COMPONENTS = [PROBES.nestedLayout, PROBES.nestedRoute];
const EXISTING_ROUTES = [EXISTING.layout, EXISTING.index];
// src/ui renders the text it is given, src/core and src/platform are not screen layers, and tests
// and fixtures hold literal data and assertions: whether the guards apply is decided per file, so
// one probe of each kind on a file of each of these config entries and globs
const OUT_OF_SCOPE_COMPONENTS = [
  PROBES.featuresTestComponent,
  PROBES.featuresFixture,
  PROBES.uiComponent,
  PROBES.hooksComponent,
  PROBES.platformComponent,
  PROBES.testMobileComponent,
];
const OUT_OF_SCOPE_MODULES = [PROBES.featuresTest, PROBES.ui, PROBES.core, PROBES.platform];

export const REJECTED = {
  'no hard-coded text in routes and features': [
    ...rejected(FULL_COMPONENTS, SYNTAX, MESSAGES.literalText, COMPONENT_TEXT),
    ...rejected(SAMPLE_COMPONENTS, SYNTAX, MESSAGES.literalText, SAMPLE_TEXT),
    ...rejected(EXISTING_ROUTES, SYNTAX, MESSAGES.literalText, SAMPLE_TEXT.slice(0, 1)),
    ...rejected(PROBES.features, SYNTAX, MESSAGES.literalText, MODULE_TEXT),
    ...rejected(PROBES.layoutTs, SYNTAX, MESSAGES.literalText, SAMPLE_MODULE_TEXT),
  ],
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'no hard-coded text in routes and features': [
    ...allowed(PROBES.featuresComponent, NO_TEXT),
    ...allowed([PROBES.notFound, ...SAMPLE_COMPONENTS], SAMPLE_NO_TEXT),
    ...allowed(EXISTING_ROUTES, SAMPLE_NO_TEXT.slice(0, 1)),
    ...allowed(OUT_OF_SCOPE_COMPONENTS, SAMPLE_TEXT),
    ...allowed(OUT_OF_SCOPE_MODULES, SAMPLE_MODULE_TEXT),
  ],
  // documents a limit, not a rule: a syntax check sees the literal only where it is written
  'no hard-coded text: stored strings (currently allowed)': allowed(
    [PROBES.notFound, PROBES.featuresComponent],
    STORED_TEXT,
  ),
  // documents a limit, not a rule: raising the bounds must update these cases on purpose
  'no hard-coded text: beyond the nesting limits (currently allowed)': allowed(
    PROBES.featuresComponent,
    BEYOND_LIMITS,
  ),
};
