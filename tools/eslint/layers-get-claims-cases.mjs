// case tables for layers.test.mjs on auth-js getClaims (tsuzuki/no-get-claims, ADR-0014
// "getClaims"): banned in the app and its tests (app/, src/, test/), where it would throw under the
// web crypto binding; the edge functions (deno's own web crypto) and the tools are left out. the
// forms of the rule are proved by its RuleTester cases (plugin/rules/no-get-claims.test.mjs)

import { PROBES } from './layers-harness.mjs';
import { allowed, rejected } from './layers-cases.mjs';

const NO_GET_CLAIMS = 'tsuzuki/no-get-claims';
const GET_CLAIMS_MESSAGE = 'Use auth.getUser()';

// probes are [label, code] pairs
const GET_CLAIMS_CALLS = [
  ['auth.getClaims()', 'export const claims = (auth) => auth.getClaims();\n'],
  [
    'const { getClaims } = auth',
    'export const claims = (auth) => {\n  const { getClaims } = auth;\n  return getClaims;\n};\n',
  ],
];

export const REJECTED = {
  'auth-js getClaims': rejected(
    [
      PROBES.nestedRoute,
      PROBES.features,
      PROBES.supabase,
      PROBES.coreTest,
      PROBES.testMobileComponent,
    ],
    NO_GET_CLAIMS,
    GET_CLAIMS_MESSAGE,
    GET_CLAIMS_CALLS,
  ),
};

// each allowed case mirrors a rejected one, so it cannot pass only because the rule never ran
export const ALLOWED = {
  'auth-js getClaims': [
    ...allowed([PROBES.edgeFunction, PROBES.tools], GET_CLAIMS_CALLS),
    ...allowed(PROBES.supabase, [
      ['auth.getUser()', 'export const user = (auth) => auth.getUser();\n'],
      ['a string naming it', "export const NOTE = 'getClaims would throw: use getUser';\n"],
    ]),
  ],
};
